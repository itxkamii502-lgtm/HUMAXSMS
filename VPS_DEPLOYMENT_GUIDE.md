# HUMEX SMS — Complete Step-by-Step VPS Deployment Guide (Windows CMD + Ubuntu VPS)

Yeh guide beginners ke liye bilkul asaan aur copy-paste **CMD / SSH commands** ke saath tayyar ki gayi hai.

---

## Step 0: Apne Computer (Windows CMD) se Production ZIP Upload Karein

Agar aap ne AI Studio / Owner Panel se project ZIP download kiya hai (e.g. `humex-sms-complete-project.zip` ya `humex-sms-vps-YYYYMMDD.zip`), ya project folder aap ke PC par hai:

1. Agar project folder aap ke PC par hai to pehle clean production ZIP banayein (Windows CMD mein project folder ke andar):
```bat
npm run pack:vps
```
*(Is se `dist\humex-sms-vps-YYYYMMDD.zip` ban jayegi — is mein sirf production files hoti hain, faltu files nahi.)*

2. Apne Windows CMD se ZIP file ko VPS par upload karein (`YOUR_VPS_IP` ki jagah apna VPS IP likhein):
```bat
scp dist\humex-sms-vps-*.zip root@YOUR_VPS_IP:/root/humex-sms.zip
```
*(Agar ZIP Downloads folder mein ho to: `scp %USERPROFILE%\Downloads\humex-sms-complete-project.zip root@YOUR_VPS_IP:/root/humex-sms.zip`)*
> **Alternative:** Agar `scp` use na karna chahein to **WinSCP** ya **FileZilla** se `/root/humex-sms.zip` par drag-drop upload kar sakte hain.

---

## Step 1: VPS par Login Karein aur Required Software Install Karein

Apne Windows CMD mein yeh command chalayein aur VPS ka password dalein:
```bat
ssh root@YOUR_VPS_IP
```

Ab VPS ke andar yeh commands aik aik kar ke run karein:

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

---

## Step 2: Folders Banayein aur Project Unzip Karein

Live database (`/var/lib/humex-sms`) ko code folder (`/var/www/humexsms`) se **alag** rakha gaya hai taake future mein code update karte waqt aap ke users, numbers aur SMS logs kabhi delete na hon:

```bash
# Code aur Data directories banayein
sudo mkdir -p /var/www/humexsms /var/lib/humex-sms/data /var/lib/humex-sms/backups
sudo chown -R $USER:$USER /var/www/humexsms /var/lib/humex-sms

# ZIP file ko code folder mein extract karein
unzip -o /root/humex-sms.zip -d /var/www/humexsms
cd /var/www/humexsms

# Production dependencies install karein
npm install --omit=dev
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

