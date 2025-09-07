# Molecula Portfolio Bot

A Telegram bot that allows investors to track their Molecula portfolio across multiple EVM addresses.  
The bot aggregates deposits, balances, and yields across all addresses provided by the user.

---

## Features

- Add, list, and remove EVM addresses tied to your Telegram account.
- Track portfolio across multiple addresses:
  - **Total deposited (USDT)** — total net deposits into Molecula (deposits - withdrawals).
  - **Current balance (mUSD)** — real-time balance of all tracked addresses.
  - **Total yield (USDT)** — profit or loss since inception.
  - **APY (since inception)** — annualized yield taking into account deposits/withdrawals timing.
- User-friendly formatting with thousands separators and 4 decimal places.
- Works via simple Telegram commands.
- Dockerized for easy deployment.

---

## Usage

You can either:

1. Use our public bot: [@Molecula_Portfolio_bot](https://t.me/Molecula_Portfolio_bot)
2. Or deploy your own instance (recommended if you manage more than 2 accounts in the Molecula ecosystem).

---

## Tech Stack

- **NestJS** – application framework
- **Telegraf** – Telegram bot framework
- **ethers.js** – blockchain RPC calls (balanceOf, etc.)
- **PostgreSQL** – storing tracked addresses per user
- **TypeORM** – ORM for Postgres
- **Docker & Docker Compose** – containerized deployment

---

## Architecture

```
                ┌───────────────────┐
                │   Telegram User   │
                └───────┬───────────┘
                        │ Commands (/add, /list, /stats)
                        ▼
                ┌───────────────────┐
                │   Telegraf Bot    │
                │  (NestJS + DI)    │
                └───────┬───────────┘
                        │
        ┌───────────────┼─────────────────┐
        ▼                               ▼
┌─────────────────┐              ┌───────────────────┐
│  Users Service  │              │ Portfolio Service │
│ (DB addresses)  │              │ (mUSD, USDT data) │
└────────┬────────┘              └──────────┬────────┘
         │                                  │
         ▼                                  ▼
┌─────────────────┐              ┌───────────────────┐
│  PostgreSQL DB  │              │ Ethereum RPC Node │
│  (addresses)    │              │ (Infura/Alchemy)  │
└─────────────────┘              └───────────────────┘
```

- **Telegram Bot** – entry point, processes commands.
- **Users Service** – stores user → addresses mapping in Postgres.
- **Portfolio Service** – fetches balances via `ethers.js`.
- **Ethereum RPC Node** – provides on-chain data for USDT & mUSD.

---

## Prerequisites

- Node.js (v18+) or Docker
- Telegram Bot Token (via [@BotFather](https://t.me/BotFather))
- RPC URL (Infura, Alchemy, or custom node)
- PostgreSQL instance

---

## Environment Variables

Create a `.env` file in the root:

```ini
# Telegram
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUvWXyz

# Ethereum
RPC_URL=https://mainnet.infura.io/v3/YOUR_API_KEY

# Molecula contracts
MUSD_TOKEN=0x86c4D4E958BaF7E911C05f3772066C30ba2d4618
USDT_TOKEN=0xdAC17F958D2ee523a2206206994597C13D831ec7

# Database
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=botuser
POSTGRES_PASSWORD=botpass
POSTGRES_DB=portfolio
```

---

## Running with Docker

Build and start services:

```bash
docker compose up -d --build
```

Check logs:

```bash
docker compose logs -f bot
```

---

## Running Locally (Dev Mode)

1. Install dependencies:

```bash
npm install
```

2. Start Postgres (e.g. with Docker):

```bash
docker run --name portfolio-db -e POSTGRES_PASSWORD=botpass -e POSTGRES_USER=botuser -e POSTGRES_DB=portfolio -p 5432:5432 -d postgres:15
```

3. Run the bot:

```bash
npm run dev
```

---

## Commands

- `/add <address>` — add an EVM address.
- `/remove <address>` — remove an address.
- `/list` — show all tracked addresses.
- `/stats` — show consolidated portfolio statistics.

---

## Example

```
/add 0x57b2D040F166a61274E8A88236b2DA45edDc6d3f
/list
/stats
```

Bot response:

```
📊 Portfolio Stats
-------------------------
💰 Total Deposited (USDT): 12000.00
🏦 Current Balance (mUSD): 12550.55
📈 Yield: 550.55
```

---

## License

MIT License © 2025 Molecula.io built by Yurin.eth
