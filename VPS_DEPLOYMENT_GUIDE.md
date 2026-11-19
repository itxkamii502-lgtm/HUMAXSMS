# HUMAX SMS — Complete Production VPS Deployment Guide (Private GitHub + Ubuntu VPS)

Yeh guide beginners ke liye bilkul asaan aur copy-paste **SSH / GitHub / VPS commands** ke saath tayyar ki gayi hai.

---

## Method A (Recommended): Private GitHub Repository ko VPS par Deploy Karein (SSH Deploy Key)

Private GitHub repo ko VPS par add karne ka **sabse safe aur professional tareeqa SSH Deploy Key** hai (is se aap ka personal GitHub password ya full account token VPS par save nahi hota — sirf is ek repo ko read-only access milta hai).

### Step A1: VPS par Login Karein aur SSH Deploy Key Banayein
```bash
ssh root@YOUR_VPS_IP

# VPS ke liye alag SSH key banayein (Enter dabate jayein, passphrase khali chhor dein)
ssh-keygen -t ed25519 -C "humax-sms-vps" -f ~/.ssh/github_humax -N ""

# Public key screen par print karein aur poori line copy kar lein
cat ~/.ssh/github_humax.pub
```

### Step A2: GitHub Private Repo mein Deploy Key Add Karein
1. Apne GitHub par **Private Repository** kholein.
2. **Settings** -> **Deploy keys** (left sidebar) -> **Add deploy key** par click karein.
3. **Title** likhein: `Production VPS`
4. **Key** box mein woh poori `ssh-ed25519 ...` line paste karein.
5. `Allow write access` **UNCHECKED** rehne dein (read-only sabse safe hai) aur **Add key** dabaa dein.

### Step A3: VPS par Git ko SSH Key batayein aur Private Repo Clone Karein
```bash
# SSH config set karein taake github.com hamesha yeh key use kare
cat << 'EOF' >> ~/.ssh/config
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/github_humax
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

# Connection test karein ("successfully authenticated" likha aana chahiye)
ssh -T git@github.com

# Code aur live Data folders alag banayein
sudo mkdir -p /var/www/humexsms /var/lib/humex-sms/data /var/lib/humex-sms/backups
sudo chown -R $USER:$USER /var/www/humexsms /var/lib/humex-sms

# Private repo clone karein (apna GitHub username aur repo name dalein)
git clone git@github.com:YOUR_GITHUB_USERNAME/YOUR_PRIVATE_REPO.git /var/www/humexsms
cd /var/www/humexsms
npm install --omit=dev
```

*(Future mein jab bhi GitHub par naya update push karein, VPS par sirf yeh 1 command chalani hogi: `cd /var/www/humexsms && bash scripts/deploy-vps.sh main` — aap ka live data bilkul safe rahega!)*

---

## Method B (Alternative): Production ZIP Upload Karein

Agar aap GitHub ke bajaye ZIP upload karna chahein:
1. PC par hardened production ZIP banayein:
```bat
npm run pack:vps
```
2. ZIP ko VPS par upload karein:
```bat
scp dist\humex-sms-vps-*.zip root@YOUR_VPS_IP:/root/humex-sms.zip
```
3. VPS par unzip karein:
```bash
sudo mkdir -p /var/www/humexsms /var/lib/humex-sms/data /var/lib/humex-sms/backups
unzip -o /root/humex-sms.zip -d /var/www/humexsms
cd /var/www/humexsms && npm install --omit=dev
```

---

## Step 1: VPS par Required Software Install Karein (Node.js 20, PM2, Nginx, SSL)

```bash
# 1. System update aur zaroori tools install karein
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git unzip nginx ufw certbot python3-certbot-nginx openssl

# 2. Node.js 20 LTS install karein
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Node version verify karein (v20.x aana chahiye)
node -v
npm -v

# 4. PM2 (24/7 background process manager) install karein
sudo npm install -g pm2
```

*(Agar aap apna purana `humex-sms/data` bhi import karna chahte hain to `/var/lib/humex-sms/data` mein copy karein, ya Owner Panel -> System Backup se `.zip` restore karein.)*

---

## Step 3: `.env` Production Config aur Random Secrets Set Karein

```bash
cd /var/www/humexsms
cp .env.example .env

# Random strong tokens auto-generate kar ke .env mein daalein
INBOUND_RAND=$(openssl rand -hex 32)
SMPP_RAND=$(openssl rand -hex 32)
sed -i "s|change_me_to_a_strong_random_inbound_token|$INBOUND_RAND|g" .env
sed -i "s|change_me_to_a_strong_random_32_byte_secret|$SMPP_RAND|g" .env
```

Ab apna domain (ya VPS IP) `.env` mein set karein:
```bash
nano .env
```
In lines ko check/update karein (save karne ke liye `Ctrl+O`, `Enter`, aur bahar nikalne ke liye `Ctrl+X`):
- `ALLOWED_ORIGINS=https://sms.yourdomain.com,http://YOUR_VPS_IP`
- `DATA_DIR=/var/lib/humex-sms/data`
- `BACKUP_DIR=/var/lib/humex-sms/backups`
- `SMS_LOG_RETENTION_DAYS=90`

---

## Step 4: Owner Password Set Karein (`Kamran_Bhatti`)

```bash
cd /var/www/humexsms
node reset-owner-password.js "ApnaStrongPasswordYahanLikhein"
```
*(Password kam az kam 8+ characters ka strong password rakhein.)*

---

## Step 5: PM2 se Server 24/7 Start Karein

```bash
cd /var/www/humexsms
pm2 start ecosystem.config.cjs
pm2 status
pm2 save
```

Server reboot hone par khud-ba-khud start karne ke liye:
```bash
pm2 startup
```
*(Agar terminal ek `sudo env PATH=...` command print kare to usko copy kar ke run kar dein.)*

Check karein ke server chal raha hai:
```bash
curl http://127.0.0.1:3000/health
```
Jawab `{"status":"ok",...}` aana chahiye!

---

## Step 6: Nginx Reverse Proxy + Free HTTPS SSL (Domain ke liye)

Nginx config file banayein:
```bash
sudo nano /etc/nginx/sites-available/humexsms
```

Neeche wala code paste karein (`sms.yourdomain.com` ki jagah apna domain likhein — agar abhi domain nahi hai to `server_name _;` likh dein):

```nginx
server {
    listen 80;
    server_name sms.yourdomain.com;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # WebSocket support (Live SMS Feed & Real-Time Notifications)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Real Client IP & HTTPS protocol forwarding
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

Enable karein aur Nginx restart karein:
```bash
sudo ln -sf /etc/nginx/sites-available/humexsms /etc/nginx/sites-enabled/humexsms
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### Free SSL Certificate (HTTPS) lagayein (Jab domain DNS VPS IP par point ho jaye):
```bash
sudo certbot --nginx -d sms.yourdomain.com
```

---

## Step 7: Firewall (UFW) Security On Karein

Sirf zaroori ports kholein (`22` SSH, `80` HTTP, `443` HTTPS, `2775` SMPP):
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 2775/tcp
sudo ufw --force enable
sudo ufw status
```

---

## Step 8: Automatic Daily Backup Lagayein (Rozana Raat 3 Baje)

```bash
chmod +x /var/www/humexsms/scripts/backup-vps.sh
# Pehla test backup abhi chala kar dekhein:
/var/www/humexsms/scripts/backup-vps.sh
```

Rozana auto-backup ke liye cron job add karein:
```bash
(crontab -l 2>/dev/null; echo "0 3 * * * /var/www/humexsms/scripts/backup-vps.sh >> /var/log/humex-backup.log 2>&1") | crontab -
```

---

## Step 9: Rozana Maintenance aur Safe Code Update Commands

```bash
# Live logs dekhne ke liye:
pm2 logs humex-sms --lines 100

# Status & RAM check:
pm2 status

# Future mein naya code update upload karne ke baad (DATA_DIR safe rahega):
unzip -o /root/humex-sms.zip -d /var/www/humexsms
cd /var/www/humexsms && npm install --omit=dev
pm2 restart humex-sms
```

