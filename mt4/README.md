# MT4/TMGM Live-Tick Bridge — VPS Setup (Step 11)

Runs MT4 + `TradeFlowMt4Bridge.mq4` (this directory) on a free VPS, so
TradeFlow's `mt4-webhook` Edge Function gets real TMGM broker ticks and
order-fill events. See `handoff/ARCHITECT-BRIEF.md`'s Step 11 for the full
design/decisions this runbook implements.

**Provider: Google Cloud Platform (e2-micro), not Oracle Cloud.** OCI was
tried first, but its free-forever x86 shape (`VM.Standard.E2.1.Micro`) is
not offered at all in every region — confirmed via `oci compute shape list`
against a real tenancy in `ap-kulai-2` (Malaysia West 2/Kulai), which only
lists paid shapes plus the ARM `VM.Standard.A1.Flex`. ARM was ruled out
separately (Wine-on-ARM needs an unreliable x86-emulation layer, unsuitable
for anything order-fill-alert-adjacent). GCP's `e2-micro` is real x86_64,
genuinely Always Free, with no such regional gap — the only constraint is
it must be created in one of three specific regions (see below), which
doesn't matter for this use case (price ticks + fill events, not
latency-sensitive scalping).

Steps marked **(manual)** need a GUI/VNC session — no scriptable path
exists for them (confirmed during design research). Everything else is a
shell command you can run over plain SSH.

## 1. Provision the VPS

1. Create/use a Google Cloud Platform account and project (the Always Free
   tier needs a billing account attached for verification, but an e2-micro
   kept within the free-tier limits below is not charged).
2. Create a compute instance:
   ```
   gcloud compute instances create tradeflow-mt4-bridge \
     --zone=us-west1-b \
     --machine-type=e2-micro \
     --image-family=ubuntu-2204-lts \
     --image-project=ubuntu-os-cloud \
     --boot-disk-size=30GB \
     --boot-disk-type=pd-standard
   ```
   `--zone` must be in **`us-west1`, `us-central1`, or `us-east1`** — Always
   Free e2-micro only applies in those three regions, regardless of where
   you actually are. `--boot-disk-type=pd-standard` (not `pd-ssd`) and
   `--boot-disk-size=30GB` matter too — that's the exact free persistent-disk
   allowance; going over either dimension starts incurring real charges.
3. Only open inbound **SSH (22)** — this VPS never receives calls, it only
   makes outbound `WebRequest()` calls to Supabase (GCP's default network
   usually already allows SSH via the `default-allow-ssh` firewall rule;
   confirm with `gcloud compute firewall-rules list`). Don't expose VNC
   (5900) directly; tunnel it over SSH when you need it:
   ```
   gcloud compute ssh tradeflow-mt4-bridge --zone=us-west1-b -- -L 5900:localhost:5900
   ```
4. Add a swap file (cheap mitigation for the free tier's 1GB RAM, which is
   below the ~2GB community-recommended minimum for stable Wine+MT4):
   ```bash
   sudo fallocate -l 4G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

## 2. Install Wine + Xvfb

```bash
sudo dpkg --add-architecture i386
sudo mkdir -pm755 /etc/apt/keyrings
sudo wget -O /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key
sudo wget -NP /etc/apt/sources.list.d/ https://dl.winehq.org/wine-builds/ubuntu/dists/jammy/winehq-jammy.sources
sudo apt update
sudo apt install -y --install-recommends winehq-stable wine32 xvfb

# MT4 is 32-bit; a dedicated 32-bit prefix keeps it isolated
export WINEARCH=win32
export WINEPREFIX=~/.wine-mt4
wineboot --init
```

Run Xvfb as a systemd service so it survives reboots:
```bash
sudo tee /etc/systemd/system/xvfb.service > /dev/null <<'EOF'
[Unit]
Description=Virtual framebuffer for headless MT4
After=network-online.target

[Service]
ExecStart=/usr/bin/Xvfb :99 -screen 0 1024x768x16
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now xvfb
export DISPLAY=:99
```

## 3. Install TMGM's MT4 client **(manual, unless its installer has a silent
   flag — verify once you have the installer in hand)**

1. Download TMGM's own branded MT4 installer (must be TMGM's, not generic
   MetaQuotes MT4 — it has TMGM's login-server list baked in).
2. Over a VNC session (tunneled per step 1.3):
   ```bash
   DISPLAY=:99 WINEPREFIX=~/.wine-mt4 wine tmgm4setup.exe
   ```
3. **(manual)** Log into your real TMGM account through MT4's own login
   dialog. Never paste real credentials into a shell, script, or chat.

## 4. Compile and deploy the EA

```bash
gcloud compute scp mt4/TradeFlowMt4Bridge.mq4 \
  tradeflow-mt4-bridge:~/.wine-mt4/drive_c/.../MQL4/Experts/ --zone=us-west1-b
```

Compile via MetaEditor's CLI (path depends on where MT4 installed):
```bash
DISPLAY=:99 WINEPREFIX=~/.wine-mt4 wine metaeditor.exe \
  /compile:"C:\...\MQL4\Experts\TradeFlowMt4Bridge.mq4" \
  /log:"C:\...\compile.log"
```

**MetaEditor's CLI compile can fail silently** (no `.ex4` produced, no
error in the shell exit code) — always verify explicitly:
```bash
ls -la .../MQL4/Experts/TradeFlowMt4Bridge.ex4   # mtime should be newer than the .mq4
grep "0 error" compile.log                        # should match
```

## 5. Attach the EA and configure WebRequest **(manual — GUI-only, no
   scriptable equivalent for either step)**

1. In MT4, open the XAUUSD chart, drag `TradeFlowMt4Bridge` onto it.
2. In the EA's Properties dialog: check **"Allow live trading"**, set
   `InpWebhookUrl` to your real function URL
   (`https://<project-ref>.supabase.co/functions/v1/mt4-webhook`) and
   `InpWebhookSecret` to the value you set as `MT4_WEBHOOK_SECRET` (step 6).
   If TMGM's XAUUSD symbol name differs from plain `"XAUUSD"` (some brokers
   suffix symbols, e.g. `XAUUSD.m`), leave `InpTradeFlowSymbol` as
   `"XAUUSD"` regardless — that's the name TradeFlow's database uses; the
   EA reads/trades the chart's actual symbol internally but always reports
   the TradeFlow-side name.
3. Tools > Options > Expert Advisors > **"Allow WebRequest for listed
   URL"**: add the exact webhook URL. Confirmed during design research:
   this is stored in a binary `experts.ini` inside the terminal's data
   folder with no CLI/API to populate it — must be done by hand.

Repeat steps 3-5 if the VPS or terminal data folder is ever rebuilt from
scratch.

## 6. Configure TradeFlow's side

1. Apply `supabase/migrations/0007_mt4_webhook.sql` via the dashboard SQL
   Editor (same manual process as every prior migration — this network
   can't run `supabase db push`).
2. Generate a secret and set it:
   ```bash
   openssl rand -base64 32
   supabase secrets set MT4_WEBHOOK_SECRET=<the generated value>
   supabase secrets set MT4_WEBHOOK_USER_ID=<your TradeFlow account's user id>
   ```
3. Deploy the function (already includes `verify_jwt = false` via
   `supabase/config.toml`):
   ```bash
   supabase functions deploy mt4-webhook
   ```

## Verification checklist

- [ ] `TradeFlowMt4Bridge.mq4` compiles cleanly (step 4) — **not yet
      verified against a real MetaEditor**, since none was available while
      writing this EA. Do this first, before anything else.
- [ ] EA attached to the XAUUSD chart, "Allow live trading" checked, no
      errors in MT4's Experts log tab.
- [ ] Webhook URL allow-listed (step 5.3) — if missed, the Experts log will
      show the explicit "URL not allow-listed" message the EA prints.
- [ ] Within `InpHeartbeatSec` (default 5s) of attaching, confirm in the
      Supabase dashboard SQL Editor:
      ```sql
      select last_price, last_price_at, mt4_last_seen_at, price_source
      from instruments where symbol = 'XAUUSD';
      ```
      `price_source` should read `'MT4'` and `mt4_last_seen_at` should be
      within the last few seconds.
- [ ] Place a small real order (manually, not via the EA) and confirm a
      push notification arrives, and a `notification_log` row with
      `event_type = 'ORDER_FILLED'` appears.
- [ ] Stop the EA (or the VPS) and confirm, after ~25s
      (`MT4_FRESHNESS_SECONDS`), `price_source` flips back to `'BINANCE'`
      in the `instruments` table — the fallback actually engaging is the
      whole point of this design.
