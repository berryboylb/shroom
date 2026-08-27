# 🍄 Shroom

**Jump in. Zero friction. 🚀**

Shroom is a blazingly fast, completely frictionless WebRTC video conferencing platform. Designed to eliminate the annoyance of long sign-up forms, downloaded clients, and lobby screens, Shroom lets users instantly spin up secure, high-quality video rooms and share them with a single link.

## ✨ Features

- **Zero-Friction Entry:** No accounts, no passwords. Type a name and you're in.
- **Enterprise WebRTC:** Powered by the LiveKit engine, supporting 1080p simulcast, dynamic network adaptation, and ultra-low latency.
- **Strict-Firewall Bypass:** Built-in TURN server relay automatically routes traffic over TCP for clients trapped behind strict corporate firewalls or symmetric NATs.
- **Auto-Rejoin Engine:** Seamlessly survives page refreshes and network drops. If you disconnect, Shroom automatically re-authenticates and drops you straight back into the video grid without showing you a single lobby screen.
- **Zero-Dependency Audio:** Custom, lightweight Web Audio API synthesizer generates pleasant entry/exit chimes mathematically using sine waves (0 bytes of MP3s required).
- **Collapsible Reactions:** Real-time floating emoji engine with a responsive, collapsible drawer to save screen real estate on mobile devices.
- **Mobile Optimized:** Fluid `100dvh` layouts natively support iOS Safari's dynamic toolbars without clipping.

## 🛠 Tech Stack

- **Frontend:** React 18, Vite, TypeScript, TailwindCSS, Zustand, Framer Motion, `@livekit/components-react`
- **Backend:** Go 1.26, Chi Router, JWT Authentication
- **Infrastructure:** Docker Compose, Caddy (Native HTTPS Proxy), LiveKit Server
- **Databases:** PostgreSQL (Analytics & Persistence), Redis (State & Caching)
- **CI/CD:** GitHub Actions (Automated zero-downtime SSH deployments)

## 🚀 Production Deployment (VPS)

Shroom is containerized and managed via Docker Compose. The production environment utilizes Caddy to natively terminate SSL/TLS and perfectly route WebRTC signaling WebSockets.

### 1. Firewall Requirements
You must open the following ports on your Ubuntu VPS (`ufw`):
```bash
sudo ufw allow 80/tcp    # HTTP (Caddy challenges)
sudo ufw allow 443/tcp   # HTTPS (Web traffic)
sudo ufw allow 7881/tcp  # LiveKit WebRTC TCP Fallback
sudo ufw allow 7882/udp  # LiveKit WebRTC UDP
sudo ufw allow 3478/tcp  # LiveKit TURN Relay TCP
sudo ufw allow 3478/udp  # LiveKit TURN Relay UDP
```

### 2. LiveKit Configuration
Ensure your server's public IP address is hardcoded in `docker/livekit/livekit.prod.yaml`:
```yaml
rtc:
  node_ip: YOUR_SERVER_PUBLIC_IP
```

### 3. CI/CD Setup
To deploy automatically on every push to `main`, add the following Secrets to your GitHub Repository:
- `VPS_HOST`: Your server's public IP address.
- `VPS_USERNAME`: Your SSH username (must be part of the `docker` group via `sudo usermod -aG docker <user>`).
- `VPS_SSH_KEY`: Your private SSH key.

Once configured, GitHub Actions will automatically connect, pull the latest code, and orchestrate the Docker container swap!

## 💻 Local Development

1. Clone the repository.
2. Run the infrastructure:
   ```bash
   docker-compose up -d postgres redis livekit
   ```
3. Start the Go backend:
   ```bash
   cd backend
   go run cmd/server/main.go
   ```
4. Start the Vite frontend:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

---
*Built for speed. Built for quality. Built for the modern web.*
