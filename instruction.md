# SEC VAULT: Quick Start

## 1. Install prerequisites

| Tool | Version | Windows | Ubuntu |
| --- | --- | --- | --- |
| Node.js | 22 LTS | Installer from [nodejs.org](https://nodejs.org) | `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh \| bash && source ~/.bashrc && nvm install 22` |
| MongoDB | 8.0 | MSI installer from [mongodb.com](https://www.mongodb.com/try/download/community), installed as a service | See the commands below |
| Gmail app password | n/a | [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (requires 2-Step Verification) | same |

MongoDB on Ubuntu 24.04:

```bash
curl -fsSL https://pgp.mongodb.com/server-8.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
sudo apt-get update && sudo apt-get install -y mongodb-org
sudo systemctl enable --now mongod
```

Check: `node --version` shows v22.x, and MongoDB is running (`Get-Service MongoDB` on Windows, `systemctl status mongod` on Ubuntu).

## 2. Install and configure

```bash
npm install
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
```

Edit `.env`:

```dotenv
MONGO_URI=mongodb://127.0.0.1:27017/hamza_password_manager
JWT_SECRET=<output of: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))">
VAULT_MASTER_KEY=<output of: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
EMAIL_FROM=homrani555@gmail.com
EMAIL_PASSWORD=<gmail app password>
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=465
SMTP_DEV_FROM=homrani555@gmail.com
SMTP_DEV_PASSWORD=<gmail app password>
SMTP_DEV_HOST=smtp.gmail.com
SMTP_DEV_PORT=465
BOOTSTRAP_ADMIN_EMAIL=homrani555@gmail.com
BOOTSTRAP_ADMIN_PASSWORD=<at least 14 characters>
```

Keep an offline copy of `VAULT_MASTER_KEY`. Never change it after passwords are stored.

Create the database and your super admin account (run once):

```bash
npm run bootstrap
```

## 3. Build

```bash
npm run build
```

## 4. Start

**Development** (auto-reload): open http://127.0.0.1:5173

```bash
npm run dev
```

**Production**: set `NODE_ENV=production` and `APP_ORIGIN=https://<your-domain>` in `.env`, then:

```bash
npm start                                  # or keep it running with PM2:
npm install -g pm2
pm2 start ecosystem.prod.config.js && pm2 save
```

The app listens on port `11000`. Check it with `curl http://127.0.0.1:11000/health`.
