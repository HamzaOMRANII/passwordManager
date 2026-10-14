# SEC VAULT

SEC VAULT is a self-hosted password manager. The production site is designed to run at `https://sec.adviio.com` on internal port `11000`.

The project uses one Node.js application for the backend and production frontend:

- Express provides authentication, authorization, vault, user, platform, useful-link, and access-management routes.
- Vite builds the browser application into `dist/`.
- Express serves the generated `dist/` directory in production.
- MongoDB stores users, encrypted vault data, access grants, OTP challenges, audit events, platforms, and useful links.
- SMTP sends the eight-digit email verification code.
- PM2 and Nginx are used for the recommended Ubuntu deployment.

## Requirements

Install the following before setting up the project:

- Node.js 20 or newer. Node.js 22 LTS is recommended.
- npm, included with Node.js.
- MongoDB Community Server 8.0 or another currently supported MongoDB release.
- A working SMTP mailbox that supports authenticated TLS.
- Git, if the project is retrieved from a Git repository.

Ubuntu production additionally requires:

- Nginx
- PM2
- Certbot or another TLS certificate manager
- `build-essential` and Python 3 if a native npm dependency must compile locally

Docker is not required. The IT Tools menu embeds `https://it-tools.tech/bcrypt`; it does not build or host the IT Tools repository.

## Project structure

```text
PassMananger/
|-- deploy/                         Nginx configuration
|-- dist/                           Generated production frontend
|-- public/                         Static source assets
|-- scripts/bootstrap.js            Organization and first-admin setup
|-- src/
|   |-- client/                     Browser JavaScript and CSS
|   |-- controllers/                Request handlers
|   |-- database/                   MongoDB connection
|   |-- middleware/                 Authentication and authorization
|   |-- models/                     Mongoose models
|   |-- routes/                     Express routes
|   |-- security/                   Vault encryption utilities
|   |-- services/                   Email and audit services
|   |-- app.js                      Express application
|   `-- server.js                   Application entry point
|-- .env.example                    Environment template
|-- ecosystem.config.js             Development PM2 configuration
|-- ecosystem.prod.config.js        Production PM2 configuration
|-- index.html                      Vite HTML entry point
|-- package.json                    Dependencies and scripts
`-- vite.config.js                  Frontend build and development proxy
```

## 1. Get the source code

Clone the repository when it is available remotely:

```bash
git clone <repository-url> sec-vault
cd sec-vault
```

If the files are delivered as an archive, extract them and open a terminal in the extracted project directory.

## 2. Install dependencies

For a new working copy:

```bash
npm install
```

When `package-lock.json` is already present and an exact reproducible installation is required, use:

```bash
npm ci
```

Do not copy an existing `node_modules` directory between Windows and Ubuntu. Install dependencies again on the target operating system.

Verify the installed versions:

```bash
node --version
npm --version
npm ls --depth=0
```

## 3. Install and start MongoDB

### Windows

Install MongoDB Community Server using the official Windows MSI installer and select the option to install MongoDB as a Windows service. Then confirm that the service is running:

```powershell
Get-Service MongoDB
Start-Service MongoDB
```

`Start-Service` may require an Administrator PowerShell window.

### Ubuntu 24.04, 22.04, or 20.04

The following installs MongoDB 8.0 from MongoDB's official repository. Set the codename to match the VPS:

- Ubuntu 24.04: `noble`
- Ubuntu 22.04: `jammy`
- Ubuntu 20.04: `focal`

```bash
sudo apt-get update
sudo apt-get install -y gnupg curl
curl -fsSL https://pgp.mongodb.com/server-8.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor

MONGODB_UBUNTU_CODENAME=noble
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu ${MONGODB_UBUNTU_CODENAME}/mongodb-org/8.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list

sudo apt-get update
sudo apt-get install -y mongodb-org
sudo systemctl enable --now mongod
sudo systemctl status mongod
```

Keep MongoDB bound to localhost unless a separately secured private database network is being used. Do not expose port `27017` publicly.

## 4. Configure the environment

Create `.env` from the provided template.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Linux or macOS:

```bash
cp .env.example .env
```

Generate two independent secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Use the first output for `JWT_SECRET` and the second output for `VAULT_MASTER_KEY`. Each command must be run separately, and the two values must not be the same.

Edit `.env`:

```dotenv
NODE_ENV=development
PORT=11000
APP_ORIGIN=http://localhost:11000
IT_TOOLS_ORIGIN=https://it-tools.tech

MONGO_URI=mongodb://127.0.0.1:27017/hamza_password_manager
JWT_SECRET=<generated-48-byte-secret>
VAULT_MASTER_KEY=<generated-32-byte-base64-key>

EMAIL_FROM=communication@example.com
EMAIL_PASSWORD=<production-smtp-password>
EMAIL_HOST=smtp.example.com
EMAIL_PORT=465

SMTP_DEV_FROM=communication@example.com
SMTP_DEV_PASSWORD=<development-smtp-password>
SMTP_DEV_HOST=smtp.example.com
SMTP_DEV_PORT=465

BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=<temporary-password-with-at-least-14-characters>
```

Environment variable behavior:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Use `development` locally and `production` on the hosted server. |
| `PORT` | Express port. This project uses `11000`. |
| `APP_ORIGIN` | Exact public application origin. Production must use `https://sec.adviio.com`. |
| `IT_TOOLS_ORIGIN` | Origin permitted by the Content Security Policy for the embedded IT Tools frame. |
| `MONGO_URI` | MongoDB connection string and database name. |
| `JWT_SECRET` | Signs authentication sessions. It must contain at least 32 characters. |
| `VAULT_MASTER_KEY` | Base64-encoded 32-byte AES key used for vault encryption. |
| `EMAIL_*` | SMTP settings used only when `NODE_ENV=production`. |
| `SMTP_DEV_*` | SMTP settings used when `NODE_ENV` is not `production`. |
| `BOOTSTRAP_ADMIN_EMAIL` | Email of the initial super administrator. |
| `BOOTSTRAP_ADMIN_PASSWORD` | Initial administrator password; minimum length is 14 characters. |

Important configuration rules:

- Do not add spaces around `=` in `.env`.
- Quote a password if it intentionally contains leading/trailing spaces or `#`.
- Port `465` uses immediate TLS. Port `587` normally uses STARTTLS.
- Never commit `.env`.
- Never change or lose `VAULT_MASTER_KEY` after data has been encrypted. Existing vault secrets cannot be decrypted without the original key.
- Use different values for `JWT_SECRET`, `VAULT_MASTER_KEY`, and all user/SMTP passwords.

## 5. Initialize the database

Make sure MongoDB is running, then execute:

```bash
npm run bootstrap
```

Bootstrap performs the following operations:

- Creates the `Hamza` organization (slug `hamza`, domain taken from `BOOTSTRAP_ADMIN_EMAIL`), or renames the existing one.
- Creates the first super administrator if the configured email does not already exist.
- Applies the existing vault-type data migration.

The command is idempotent: running it again does not create a duplicate administrator.

After successful bootstrap, remove `BOOTSTRAP_ADMIN_PASSWORD` from the production `.env` or replace it with a non-sensitive placeholder. It is not required by the running server.

## 6. Run locally

### Development mode

Start Express and Vite together:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

Development services:

- Vite frontend: `127.0.0.1:5173`
- Express backend: `127.0.0.1:11000`
- Vite proxies `/api` and `/health` to Express.

### Production-like local mode

Build the frontend and run only Express:

```bash
npm run build
npm start
```

Open:

```text
http://127.0.0.1:11000
```

Do not use `npm run preview` as the hosted production server. It is only a Vite build preview.

## 7. Validate the project

Run the project checks and production build:

```bash
npm run check
```

Check the backend health endpoint:

```bash
curl http://127.0.0.1:11000/health
```

Expected response:

```json
{"status":"ok","service":"sec-vault"}
```

Available npm commands:

| Command | Description |
| --- | --- |
| `npm run dev` | Runs the watched backend and Vite development server. |
| `npm run build` | Generates the production frontend in `dist/`. |
| `npm start` | Runs Express on the configured port. |
| `npm run bootstrap` | Creates the organization and first super administrator. |
| `npm run check` | Checks backend syntax and performs a production frontend build. |
| `npm run preview` | Previews the Vite build; not intended for production hosting. |

## 8. Deploy to an Ubuntu VPS

These steps assume Ubuntu 24.04 or 22.04, a non-root deployment account, and the public domain `sec.adviio.com`.

### 8.1 Configure DNS

Create an `A` record:

```text
sec.adviio.com -> <VPS-public-IPv4-address>
```

Add an `AAAA` record only when IPv6 is correctly configured. Confirm DNS resolves to the VPS before requesting the TLS certificate.

### 8.2 Install system packages

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y git curl build-essential python3 nginx snapd
```

Install MongoDB using the instructions in section 3.

### 8.3 Install Node.js with nvm

Install nvm for the non-root deployment user, then install Node.js 22:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
source ~/.bashrc
nvm install 22
nvm alias default 22
node --version
npm --version
```

Run the application and PM2 under this same non-root account.

### 8.4 Upload or clone the application

Example using Git:

```bash
sudo mkdir -p /var/www/sec-vault
sudo chown -R "$(id -un)":"$(id -gn)" /var/www/sec-vault
git clone <repository-url> /var/www/sec-vault
cd /var/www/sec-vault
npm ci
```

If the project is uploaded with SFTP/SCP instead, upload source files and `package-lock.json`, but do not upload `node_modules` or a local `.env` containing development credentials. Then run `npm ci` on the VPS.

### 8.5 Create the production environment

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

Production must contain at least:

```dotenv
NODE_ENV=production
PORT=11000
APP_ORIGIN=https://sec.adviio.com
IT_TOOLS_ORIGIN=https://it-tools.tech
MONGO_URI=mongodb://127.0.0.1:27017/hamza_password_manager
JWT_SECRET=<unique-production-secret>
VAULT_MASTER_KEY=<unique-production-32-byte-base64-key>
EMAIL_FROM=<smtp-mailbox-address>
EMAIL_PASSWORD=<smtp-mailbox-password>
EMAIL_HOST=<smtp-server>
EMAIL_PORT=465
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=<temporary-password-with-at-least-14-characters>
```

`SMTP_DEV_*` variables are not used in production but may remain as non-secret placeholders.

### 8.6 Bootstrap, validate, and build

```bash
npm run bootstrap
npm run check
```

`npm run check` generates a fresh `dist/` production build. Confirm MongoDB and the health endpoint before configuring Nginx.

### 8.7 Run with PM2

```bash
npm install -g pm2
cd /var/www/sec-vault
pm2 start ecosystem.prod.config.js
pm2 status
pm2 logs sec-vault --lines 100
pm2 save
pm2 startup
```

Run the exact `sudo ... pm2 startup ...` command printed by PM2, then run `pm2 save` once more. This makes the application return after a VPS reboot.

Test Express directly on the VPS:

```bash
curl http://127.0.0.1:11000/health
```

### 8.8 Configure Nginx

The repository includes `deploy/nginx-sec.adviio.com.conf`.

```bash
sudo cp deploy/nginx-sec.adviio.com.conf /etc/nginx/sites-available/sec.adviio.com
sudo ln -s /etc/nginx/sites-available/sec.adviio.com /etc/nginx/sites-enabled/sec.adviio.com
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

The provided Nginx server proxies public HTTP traffic to Express at `127.0.0.1:11000` and forwards the original host, client address, and protocol headers.

### 8.9 Enable HTTPS

Install Certbot using the officially recommended snap package:

```bash
sudo snap install --classic certbot
sudo /snap/bin/certbot --nginx -d sec.adviio.com
sudo /snap/bin/certbot renew --dry-run
```

After Certbot succeeds, verify:

```text
https://sec.adviio.com/health
https://sec.adviio.com
```

Production authentication cookies are marked `Secure`, so HTTPS is required for normal production sign-in.

### 8.10 Configure the firewall

Allow SSH before enabling the firewall so the VPS session is not locked out:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

Do not create public firewall rules for ports `11000` or `27017`. Nginx should be the only public entry point to the application.

## 9. Production updates

For a Git-based deployment:

```bash
cd /var/www/sec-vault
git pull --ff-only
npm ci
npm run check
pm2 reload ecosystem.prod.config.js --update-env
pm2 status
```

Run `npm run bootstrap` during an update only when a release includes a documented database bootstrap/migration change.

If `.env` changes, always use `--update-env` when reloading PM2.

## 10. Backups and recovery

Back up both MongoDB and the encryption key. A database backup without the original `VAULT_MASTER_KEY` cannot restore encrypted passwords.

Example MongoDB backup:

```bash
mkdir -p backups
mongodump --uri="mongodb://127.0.0.1:27017/hamza_password_manager" --out="backups/hamza-$(date +%Y%m%d-%H%M%S)"
```

Store backups outside the web directory and encrypt them before copying them off the VPS. Store a protected copy of `VAULT_MASTER_KEY` separately from the database backup.

Before restoring production data, stop application writes and verify the exact backup target. Test restore procedures in a separate environment first.

## 11. Security notes

- Restrict SSH, MongoDB, `.env`, backups, and PM2 access to trusted administrators.
- Use a dedicated SMTP credential and rotate it if exposed.
- The application encrypts vault payloads with AES-256-GCM.
- Personal vault items are not visible to administrators unless explicitly shared.
- All secret reveals and administrative changes are audited.
- Active OTP challenges currently contain a readable `code` value in MongoDB as required by this project. Anyone with database read access may use an active code, so MongoDB access must remain private and tightly controlled.
- The readable OTP is removed after successful verification; failed delivery deletes the challenge, and the TTL index removes expired challenges.
- The embedded IT Tools page is operated by a third party. Users can use the Open in new tab fallback if that provider changes its iframe policy.
- Email OTP is not phishing-resistant. Consider adding WebAuthn/passkeys and arranging an independent security assessment before high-assurance production use.

## 12. Troubleshooting

### `MongooseServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017`

MongoDB is not running or `MONGO_URI` points to the wrong host/port.

Windows:

```powershell
Get-Service MongoDB
Start-Service MongoDB
```

Ubuntu:

```bash
sudo systemctl status mongod
sudo systemctl start mongod
```

### `535 Authentication credentials invalid`

The SMTP server rejected the configured mailbox credentials.

- Development uses `SMTP_DEV_FROM` and `SMTP_DEV_PASSWORD`.
- Production uses `EMAIL_FROM` and `EMAIL_PASSWORD`.
- Confirm there are no duplicate variables later in `.env` overriding the correct values.
- Restart Express or reload PM2 after changing `.env`.
- Confirm that the SMTP username is the complete mailbox address and that the selected port/security mode matches the provider.

### `Missing environment variables`

Read the variable names in the startup error. Remember that the required SMTP variable set changes with `NODE_ENV`.

### `VAULT_MASTER_KEY must decode to exactly 32 bytes`

Generate the value with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Do not replace an existing production key after passwords have been created.

### `Incorrect email or password`

Confirm `npm run bootstrap` completed and that `BOOTSTRAP_ADMIN_EMAIL` was correct. Bootstrap does not overwrite the password of an existing administrator.

### `403 Untrusted request origin`

Set production `APP_ORIGIN` to the exact browser origin, including `https://` and without an unrelated port:

```dotenv
APP_ORIGIN=https://sec.adviio.com
```

Then reload PM2 with `--update-env`.

### The page loads but frontend changes are missing

Rebuild `dist/`, reload the application, and hard-refresh the browser:

```bash
npm run build
pm2 reload ecosystem.prod.config.js --update-env
```

### Nginx returns `502 Bad Gateway`

Check that Express is running on port 11000:

```bash
pm2 status
pm2 logs sec-vault --lines 100
curl http://127.0.0.1:11000/health
```

### Port 11000 is already in use

Find the process already listening on the port, stop the duplicate application instance, or configure one consistent internal port in `.env`, PM2, Vite, and Nginx.

## Official installation references

- [Node.js downloads](https://nodejs.org/en/download)
- [nvm installation](https://github.com/nvm-sh/nvm#installing-and-updating)
- [MongoDB Community Edition on Ubuntu](https://www.mongodb.com/docs/v8.0/tutorial/install-mongodb-on-ubuntu/)
- [PM2 quick start](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [PM2 startup scripts](https://pm2.keymetrics.io/docs/usage/startup/)
- [Certbot with Nginx on Ubuntu](https://certbot.eff.org/instructions?ws=nginx&os=snap)
