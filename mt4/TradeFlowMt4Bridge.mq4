//+------------------------------------------------------------------+
//| TradeFlowMt4Bridge.mq4                                          |
//| TradeFlow — Step 11: MT4/TMGM live-tick bridge + order-fill      |
//| alerts. See handoff/ARCHITECT-BRIEF.md's Step 11 Decisions and   |
//| mt4/README.md for the full design/setup story.                  |
//|                                                                    |
//| Attach this EA to the XAUUSD chart on the VPS-hosted MT4 terminal.|
//| It pushes real broker ticks and detects order fills (placed       |
//| manually or otherwise — not just ones this EA itself opens),      |
//| POSTing both to TradeFlow's `mt4-webhook` Supabase Edge Function. |
//| It NEVER places, modifies, or closes any trade itself — a webhook |
//| outage has zero effect on actual trading by construction.         |
//|                                                                    |
//| NOT YET COMPILED OR TESTED against a real MetaEditor/MT4 terminal |
//| (none available in the environment this was written in) — verify  |
//| it compiles cleanly and behaves as expected on the actual VPS     |
//| before trusting it for anything real. See mt4/README.md's         |
//| verification checklist.                                           |
//+------------------------------------------------------------------+
#property strict
#property copyright "TradeFlow"
#property version   "1.00"

//--- Inputs: set per-attach via the EA Properties dialog, never hardcode
//--- real values into this source file or commit them to git.
input string InpWebhookUrl      = "https://<project-ref>.supabase.co/functions/v1/mt4-webhook";
input string InpWebhookSecret   = ""; // matches the MT4_WEBHOOK_SECRET Edge Function secret
input string InpTradeFlowSymbol = "XAUUSD"; // the symbol name TradeFlow's DB uses — see note below
input int    InpHeartbeatSec    = 5;   // OnTimer cadence; tick-fast's fallback gate is 25s (2x this + margin)
input int    InpTimeoutMs       = 5000;

//--- Ticket/type snapshot, rebuilt fully on every poll (not incrementally
//--- patched) to avoid a known MQL4 community pitfall: OrdersTotal() can
//--- appear unchanged between two ticks even though the underlying set of
//--- orders actually changed (one closed, one opened). A full rescan every
//--- time is cheap at personal-account order volumes and has no such blind
//--- spot. Deliberately NOT using GlobalVariableSet/Get for persistence —
//--- OnInit()'s own full rescan already reconstructs correct state on every
//--- EA restart or VPS reboot, which is the only case persistence would
//--- help with.
int      g_tickets[];
int      g_types[];
int      g_ticketCount = 0;
datetime g_lastPriceSentAt = 0;

int OnInit()
{
   EventSetTimer(InpHeartbeatSec);
   RebuildOrderSnapshot(); // baseline only — orders already open/pending at
                           // EA-start are "known," never reported as fills
   Print("TradeFlowMt4Bridge initialized for ", Symbol(), " -> webhook symbol \"",
         InpTradeFlowSymbol, "\". Webhook URL: ", InpWebhookUrl);
   return (INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTick()
{
   // Throttled: XAUUSD can tick multiple times/second, and tick-fast's own
   // fallback gate only needs a heartbeat at least every ~25s — pushing
   // every single tick is a needless blocking WebRequest() call with no
   // freshness benefit.
   if (TimeCurrent() - g_lastPriceSentAt >= 1)
   {
      SendPriceTick();
      g_lastPriceSentAt = TimeCurrent();
   }
   CheckForFills(); // cheap local scan; no network call unless a fill is found
}

void OnTimer()
{
   // Guaranteed cadence regardless of tick activity — keeps
   // instruments.mt4_last_seen_at fresh even in a quiet market.
   SendPriceTick();
   g_lastPriceSentAt = TimeCurrent();
   CheckForFills();
}

//+------------------------------------------------------------------+
//| Price tick                                                        |
//+------------------------------------------------------------------+
void SendPriceTick()
{
   double price = NormalizeDouble((Bid + Ask) / 2.0, Digits);
   string json = StringFormat(
      "{\"type\":\"PRICE_TICK\",\"symbol\":\"%s\",\"price\":%s}",
      InpTradeFlowSymbol, DoubleToString(price, Digits)
   );
   PostJson(json);
}

//+------------------------------------------------------------------+
//| Fill detection                                                    |
//|                                                                    |
//| A ticket's number persists when a pending order (OP_BUYLIMIT /     |
//| OP_SELLLIMIT / OP_BUYSTOP / OP_SELLSTOP) triggers into a live      |
//| position — only OrderType() changes. So "new fill" is either:      |
//|   (a) a never-before-seen ticket that's already OP_BUY/OP_SELL, or |
//|   (b) a previously-seen ticket whose type just changed to          |
//|       OP_BUY/OP_SELL from something else (was pending).            |
//| Tracking ticket -> last-seen type (not just a set of known         |
//| tickets) is required to catch case (b). This also catches fills    |
//| from orders NOT placed by this EA (the owner trades manually) —    |
//| checking OrderSend()'s own result would miss those entirely.       |
//+------------------------------------------------------------------+
void CheckForFills()
{
   int total = OrdersTotal();
   int newTickets[];
   int newTypes[];
   ArrayResize(newTickets, total);
   ArrayResize(newTypes, total);
   int count = 0;

   for (int i = 0; i < total; i++)
   {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;

      int ticket = OrderTicket();
      int type   = OrderType();
      newTickets[count] = ticket;
      newTypes[count]   = type;
      count++;

      bool isLive = (type == OP_BUY || type == OP_SELL);
      if (!isLive) continue;

      int prevIndex = FindTicketIndex(ticket);
      bool isNewFill = (prevIndex < 0) || (g_types[prevIndex] != type);
      if (isNewFill) SendOrderFilled(ticket);
   }

   // Replace the snapshot wholesale (closed tickets simply drop out —
   // closes are out of scope for this EA).
   ArrayResize(g_tickets, count);
   ArrayResize(g_types, count);
   for (int j = 0; j < count; j++)
   {
      g_tickets[j] = newTickets[j];
      g_types[j]   = newTypes[j];
   }
   g_ticketCount = count;
}

void RebuildOrderSnapshot()
{
   int total = OrdersTotal();
   ArrayResize(g_tickets, total);
   ArrayResize(g_types, total);
   int count = 0;
   for (int i = 0; i < total; i++)
   {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      g_tickets[count] = OrderTicket();
      g_types[count]   = OrderType();
      count++;
   }
   ArrayResize(g_tickets, count);
   ArrayResize(g_types, count);
   g_ticketCount = count;
}

int FindTicketIndex(int ticket)
{
   for (int i = 0; i < g_ticketCount; i++)
      if (g_tickets[i] == ticket) return i;
   return -1;
}

void SendOrderFilled(int ticket)
{
   if (!OrderSelect(ticket, SELECT_BY_TICKET)) return;

   string orderTypeStr = (OrderType() == OP_BUY) ? "BUY" : "SELL";
   string json = StringFormat(
      "{\"type\":\"ORDER_FILLED\",\"ticket\":%d,\"symbol\":\"%s\",\"orderType\":\"%s\",\"volume\":%s,\"price\":%s}",
      ticket, InpTradeFlowSymbol, orderTypeStr,
      DoubleToString(OrderLots(), 2), DoubleToString(OrderOpenPrice(), Digits)
   );
   PostJson(json);
}

//+------------------------------------------------------------------+
//| WebRequest wrapper — every failure mode is logged and swallowed,  |
//| never fatal. The EA never places/modifies/closes trades itself,   |
//| so a webhook outage has zero effect on actual trading.            |
//|                                                                    |
//| The target URL (InpWebhookUrl) MUST be added under Tools >         |
//| Options > Expert Advisors > "Allow WebRequest for listed URL"      |
//| first — this is a GUI-only setting with no scriptable equivalent.  |
//| An unlisted URL fails with GetLastError() == 4060.                 |
//+------------------------------------------------------------------+
void PostJson(string json)
{
   char data[];
   char result[];
   string resultHeaders;

   // StringToCharArray appends a trailing null terminator; trim it so the
   // POST body is exactly the JSON text, not JSON + one extra \0 byte.
   int size = StringToCharArray(json, data) - 1;
   ArrayResize(data, size);

   string headers = "Content-Type: application/json\r\nx-webhook-secret: " + InpWebhookSecret + "\r\n";

   ResetLastError();
   int status = WebRequest("POST", InpWebhookUrl, headers, InpTimeoutMs, data, result, resultHeaders);

   if (status == -1)
   {
      int err = GetLastError();
      if (err == 4060)
      {
         Print("TradeFlowMt4Bridge: WebRequest URL not allow-listed. Add '", InpWebhookUrl,
               "' under Tools > Options > Expert Advisors > Allow WebRequest for listed URL.");
      }
      else
      {
         Print("TradeFlowMt4Bridge: WebRequest failed, error ", err);
      }
      return;
   }

   if (status != 200)
   {
      Print("TradeFlowMt4Bridge: webhook returned HTTP ", status, ": ", CharArrayToString(result));
   }
}
