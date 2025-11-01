# Hetzner VPS Documentation

**Date Created:** November 1, 2025
**Server Status:** Active

---

## Server Specifications


| Specification         | Details                     |
| ----------------------- | ----------------------------- |
| **Provider**          | Hetzner Cloud               |
| **IP Address (IPv4)** | `46.224.45.186`             |
| **IP Address (IPv6)** | `2a01:4f8:c014:2805::/64`   |
| **Operating System**  | Ubuntu 24.04.3 LTS          |
| **Kernel**            | 6.8.0-87-generic x86_64     |
| **RAM**               | 8GB                         |
| **Disk Space**        | 74.79GB                     |
| **Location**          | Falkenstein, Germany (fsn1) |
| **Hostname**          | ubuntu-8gb-fsn1             |

---

## User Accounts

### 1. Root User

**Username:** `root`
**SSH Key Location:** `~/.ssh/hetzner_vps`
**Public Key:**

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIElxbaTmH7oo05H8gQt07KwH896vuptavr/6o//2zw7 hetzner-vps-server
```

**Key Fingerprint:** `SHA256:/DGPeQav4pIApimb/HrEPsm0KchB91lHVMxDkbtuVkQ`

### 2. Madhav User

**Username:** `madhav`
**Password:** `h6GN7UaqwLBCdnx`
**SSH Key Location:** `~/.ssh/hetzner_madhav`
**Public Key:**

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIHtl+pbrz2CF0Dvf+/aqjACN8IRi4nYxeycGQtHqQVn madhav@hetzner-vps
```

**Key Fingerprint:** `SHA256:1FrhFeMZHA7b0pG8BhHKCqNLbHK8ZscfIXzAQNa7hTM`
**Sudo Access:** Yes (member of sudo group)

---

## SSH Access

### From Original Device (with SSH config)

**SSH Config Location:** `~/.ssh/config`

```
# Hetzner VPS - Root User
Host hetzner
    HostName 46.224.45.186
    User root
    IdentityFile ~/.ssh/hetzner_vps

# Hetzner VPS - Madhav User
Host hetzner-madhav
    HostName 46.224.45.186
    User madhav
    IdentityFile ~/.ssh/hetzner_madhav
```

**Connect as root:**

```bash
ssh hetzner
```

**Connect as madhav:**

```bash
ssh hetzner-madhav
```

### From New Device/Location

If you need to access the VPS from a different computer where the SSH keys are not saved:

#### Option 1: Transfer Existing Keys (Recommended)

1. **Copy private keys from original device to new device:**

   ```bash
   # On original device, copy keys to USB or use scp
   cp ~/.ssh/hetzner_vps /path/to/usb/
   cp ~/.ssh/hetzner_madhav /path/to/usb/

   # On new device, copy to SSH directory
   cp /path/from/usb/hetzner_vps ~/.ssh/
   cp /path/from/usb/hetzner_madhav ~/.ssh/
   chmod 600 ~/.ssh/hetzner_vps
   chmod 600 ~/.ssh/hetzner_madhav
   ```
2. **Add SSH config to new device:**

   ```bash
   # Copy the SSH config from above to ~/.ssh/config
   chmod 600 ~/.ssh/config
   ```
3. **Connect:**

   ```bash
   ssh hetzner
   # or
   ssh hetzner-madhav
   ```

#### Option 2: Password Authentication (Madhav user only)

Since we have the madhav password, you can connect without keys:

```bash
ssh madhav@46.224.45.186
# Password: h6GN7UaqwLBCdnx
```

#### Option 3: Generate New Keys for New Device

1. **Generate new SSH key on new device:**

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/new_device_hetzner -C "new-device@hetzner"
   ```
2. **Add new public key to server:**

   ```bash
   # Login with password or existing key
   ssh madhav@46.224.45.186

   # Add new public key
   echo "YOUR_NEW_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
   ```

---

## Setup Commands Run

### Initial SSH Key Generation (Local Machine)

```bash
# Generated root SSH key
ssh-keygen -t ed25519 -f ~/.ssh/hetzner_vps -C "hetzner-vps-server" -N ""

# Generated madhav SSH key
ssh-keygen -t ed25519 -f ~/.ssh/hetzner_madhav -C "madhav@hetzner-vps" -N ""

# Created SSH config
cat > ~/.ssh/config << 'EOF'
# Hetzner VPS - Root User
Host hetzner
    HostName 46.224.45.186
    User root
    IdentityFile ~/.ssh/hetzner_vps

# Hetzner VPS - Madhav User
Host hetzner-madhav
    HostName 46.224.45.186
    User madhav
    IdentityFile ~/.ssh/hetzner_madhav
EOF

chmod 600 ~/.ssh/config
```

### Server Setup (As Root)

```bash
# Create madhav user
adduser madhav

# Add madhav to sudo group
usermod -aG sudo madhav

# Set up SSH directory for madhav
mkdir -p /home/madhav/.ssh
chmod 700 /home/madhav/.ssh

# Add public key
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIHtl+pbrz2CF0Dvf+/aqjACN8IRi4nYxeycGQtHqQVn madhav@hetzner-vps" > /home/madhav/.ssh/authorized_keys

# Set proper permissions
chmod 600 /home/madhav/.ssh/authorized_keys
chown -R madhav:madhav /home/madhav/.ssh
```

### Firewall Configuration (As Madhav) ✅ COMPLETED

```bash
# Enable SSH access through firewall
sudo ufw allow OpenSSH
# Password entered: h6GN7UaqwLBCdnx
# Rules updated
# Rules updated (v6)

# Allow HTTP traffic (port 80)
sudo ufw allow 80/tcp
# Rules updated
# Rules updated (v6)

# Allow HTTPS traffic (port 443)
sudo ufw allow 443/tcp
# Rules updated
# Rules updated (v6)

# Allow Docker Swarm networking
sudo ufw allow 2377/tcp
# Rules updated
# Rules updated (v6)

sudo ufw allow 7946/tcp
# Rules updated
# Rules updated (v6)

sudo ufw allow 7946/udp
# Rules updated
# Rules updated (v6)

sudo ufw allow 4789/udp
# Rules updated
# Rules updated (v6)

# Enable firewall
sudo ufw enable
# Firewall is active and enabled on system startup
```

**Current Firewall Status:**
```
Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)

To                         Action      From
--                         ------      ----
22/tcp (OpenSSH)           ALLOW IN    Anywhere
80/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere
2377/tcp                   ALLOW IN    Anywhere
7946/tcp                   ALLOW IN    Anywhere
7946/udp                   ALLOW IN    Anywhere
4789/udp                   ALLOW IN    Anywhere
22/tcp (OpenSSH (v6))      ALLOW IN    Anywhere (v6)
80/tcp (v6)                ALLOW IN    Anywhere (v6)
443/tcp (v6)               ALLOW IN    Anywhere (v6)
2377/tcp (v6)              ALLOW IN    Anywhere (v6)
7946/tcp (v6)              ALLOW IN    Anywhere (v6)
7946/udp (v6)              ALLOW IN    Anywhere (v6)
4789/udp (v6)              ALLOW IN    Anywhere (v6)
```

### System Update (As Madhav) ✅ COMPLETED

```bash
# Update package lists
sudo apt update
# All packages are up to date.

# Upgrade installed packages
sudo apt upgrade -y
# 0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.

# Remove unnecessary packages
sudo apt autoremove -y
# 0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
```

### Docker Installation (As Madhav) ✅ COMPLETED

```bash
# Install prerequisites
sudo apt install -y apt-transport-https ca-certificates curl software-properties-common
# apt-transport-https installed successfully

# Add Docker's official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Add Docker repository
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Update package lists with Docker repository
sudo apt update

# Install Docker and related packages
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
# Successfully installed:
# - containerd.io (1.7.28-1)
# - docker-ce-cli (5:28.5.1-1)
# - docker-ce (5:28.5.1-1)
# - docker-buildx-plugin (0.29.1-1)
# - docker-compose-plugin (2.40.3-1)
# - docker-ce-rootless-extras (5:28.5.1-1)

# Add madhav to docker group
sudo usermod -aG docker madhav

# Start Docker service
sudo systemctl start docker

# Enable Docker to start on boot
sudo systemctl enable docker

# Verify installation
docker --version
# Docker version 28.5.1, build e180ab8

docker compose version
# Docker Compose version v2.40.3
```

**Installation Status:** ✅ Docker successfully installed and running
**Docker Version:** 28.5.1
**Docker Compose Version:** 2.40.3

**Note:** Logged out and logged back in for docker group changes to take effect.

### Caddy Installation (Reverse Proxy) ✅ COMPLETED

```bash
# Install Caddy prerequisites
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
# debian-keyring and debian-archive-keyring installed successfully

# Add Caddy GPG key
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg

# Add Caddy repository
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list

# Install Caddy
sudo apt update
sudo apt install -y caddy
# Successfully installed Caddy 2.10.2
```

**Caddy Status:** ✅ Installed and running (version 2.10.2)

### Project Directory Structure ✅ COMPLETED

```bash
# Create projects directory
mkdir -p ~/projects
cd ~/projects

# Set proper permissions
chmod -R 755 ~/projects
```

**Directory Status:** ✅ `/home/madhav/projects` created and ready

### Monitoring Tools Installation ✅ COMPLETED

```bash
# htop already installed
sudo apt install -y htop
# htop is already the newest version (3.3.0-4build1)

# Install ctop (Docker container monitoring dashboard)
sudo wget https://github.com/bcicen/ctop/releases/download/v0.7.7/ctop-0.7.7-linux-amd64 -O /usr/local/bin/ctop
sudo chmod +x /usr/local/bin/ctop
# Successfully downloaded and installed ctop v0.7.7

# Install lazydocker (Docker container monitoring)
curl https://raw.githubusercontent.com/jesseduffield/lazydocker/master/scripts/install_update_linux.sh | bash
# Successfully installed lazydocker

# Install fastfetch (modern system information tool)
wget -qO fastfetch.tar.gz https://github.com/fastfetch-cli/fastfetch/releases/latest/download/fastfetch-linux-amd64.tar.gz
sudo tar xf fastfetch.tar.gz --strip-components=3 -C /usr/local/bin fastfetch-linux-amd64/usr/bin/fastfetch
rm -rf fastfetch.tar.gz
# Successfully installed fastfetch v2.54.0

# Verify fastfetch installation
fastfetch --version
# fastfetch 2.54.0 (x86_64)
```

**Monitoring Tools Status:** 
- ✅ htop v3.3.0 (system monitoring)
- ✅ ctop v0.7.7 (Docker container dashboard)
- ✅ lazydocker (interactive Docker UI)
- ✅ fastfetch v2.54.0 (system information display)

### Automatic Backup Configuration ✅ COMPLETED

```bash
# Create backup script
mkdir -p ~/scripts
cat > ~/scripts/backup-containers.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/docker"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup docker volumes
sudo tar -czf $BACKUP_DIR/volumes_$DATE.tar.gz /var/docker-volumes/

# Backup docker compose files
tar -czf $BACKUP_DIR/compose_files_$DATE.tar.gz ~/projects/*/docker-compose.yml

# Keep only last 7 days of backups
find $BACKUP_DIR -type f -mtime +7 -delete
EOF

chmod +x ~/scripts/backup-containers.sh

# Add to crontab (daily at 2 AM)
(crontab -l 2>/dev/null; echo "0 2 * * * ~/scripts/backup-containers.sh") | crontab -
```

**Backup Status:** ✅ Automated daily backups configured (runs at 2 AM UTC)

### Security Hardening ✅ COMPLETED

```bash
# Install fail2ban for brute force protection
sudo apt install -y fail2ban
# Successfully installed fail2ban 1.0.2-3ubuntu0.1

# Start and enable fail2ban
sudo systemctl start fail2ban
sudo systemctl enable fail2ban
# fail2ban is active and enabled on system startup

# Configure automatic security updates
sudo apt install -y unattended-upgrades
# unattended-upgrades is already the newest version (2.9.1+nmu4ubuntu1)

sudo dpkg-reconfigure -plow unattended-upgrades
# Automatic security updates enabled
```

**Security Status:**
- ✅ fail2ban v1.0.2 active (brute force protection)
- ✅ unattended-upgrades v2.9.1 enabled (automatic security updates)

### Docker Log Rotation ✅ COMPLETED

```bash
# Create Docker daemon config for log rotation
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json > /dev/null <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

# Restart Docker to apply changes
sudo systemctl restart docker
```

**Log Rotation Status:** ✅ Configured (max 10MB per log file, 3 files retained)

---

## Additional Setup for Container-Based Projects

Setup progress for hosting multiple containerized projects:
- ✅ Firewall configured (UFW enabled with necessary ports)
- ✅ System updated and upgraded
- ✅ Docker and Docker Compose installed (v28.5.1 / v2.40.3)
- ✅ Caddy reverse proxy installed (v2.10.2)
- ✅ Project directory structure created
- ✅ Monitoring tools installed (htop, ctop, lazydocker)
- ✅ Automatic backups configured (daily at 2 AM UTC)
- ✅ Security hardening complete (fail2ban, unattended-upgrades)
- ✅ Docker log rotation configured

**Remaining optional steps:**

### 1. Configure Caddy Reverse Proxy (When Ready to Deploy)

**To configure Caddy for your projects, edit the Caddyfile:**

```bash
sudo nano /etc/caddy/Caddyfile
```

**Example Caddyfile for multiple projects:**

```
# Video Grabber Project
videograbber.yourdomain.com {
    reverse_proxy localhost:3000
}

# Another Project
project2.yourdomain.com {
    reverse_proxy localhost:4000
}

# Default catch-all
:80 {
    respond "Server is running" 200
}
```

```bash
# Reload Caddy after editing
sudo systemctl reload caddy
```

### 2. Configure Docker Networks (When Deploying Projects)

Create separate Docker networks for project isolation:

```bash
# Create network for video-grabber
docker network create video-grabber-network

# Create networks for other projects as needed
docker network create project2-network
docker network create project3-network

# List networks
docker network ls
```

### 3. Set Up Persistent Storage (When Deploying Projects)

```bash
# Create volumes directory for persistent data
sudo mkdir -p /var/docker-volumes
sudo chown -R madhav:madhav /var/docker-volumes

# Create project-specific volume directories
mkdir -p /var/docker-volumes/video-grabber
mkdir -p /var/docker-volumes/project2
```

### 4. Optional: Disable Root Password Login (Extra Security)

```bash
# Disable root password login (SSH key only)
sudo sed -i 's/#PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sudo systemctl restart sshd
```

---

## Deploying Video Grabber Project

### Steps to Deploy

1. **Clone the repository:**

   ```bash
   cd ~/projects
   git clone <your-repo-url> video-grabber
   cd video-grabber
   ```
2. **Set up environment variables:**

   ```bash
   cp apps/frontend/.env.example apps/frontend/.env.production
   cp apps/backend/.env.example apps/backend/.env.production
   # Edit .env files with production values
   ```
3. **Build and start containers:**

   ```bash
   docker compose up -d --build
   ```
4. **Configure Caddy reverse proxy:**

   ```bash
   sudo nano /etc/caddy/Caddyfile
   # Add your domain configuration
   sudo systemctl reload caddy
   ```
5. **Monitor logs:**

   ```bash
   docker compose logs -f
   ```

---

## Useful Commands

### System Management

```bash
# Check system resources
htop

# Check disk usage
df -h

# Check memory usage
free -h

# Check running processes
ps aux

# Reboot server
sudo reboot
```

### Docker Management

```bash
# List all containers
docker ps -a

# View container logs
docker compose logs -f [service-name]

# Restart a service
docker compose restart [service-name]

# Stop all containers
docker compose down

# Remove unused containers/images
docker system prune -a

# View Docker resource usage
docker stats

# Interactive Docker dashboard
ctop
# or
lazydocker
```

### Firewall Management

```bash
# Check firewall status
sudo ufw status verbose

# Allow a port
sudo ufw allow <port>/tcp

# Deny a port
sudo ufw deny <port>/tcp

# Delete a rule
sudo ufw delete allow <port>/tcp

# Reload firewall
sudo ufw reload
```

### Network Troubleshooting

```bash
# Check open ports
sudo netstat -tulpn

# Test connectivity
curl -I http://localhost:3000

# Check DNS resolution
nslookup yourdomain.com

# Trace route
traceroute yourdomain.com
```

---

## Domain Configuration

To access your projects via domain names:

1. **Point your domain to the VPS:**

   - Create an A record: `@` or `videograbber` → `46.224.45.186`
   - Create an AAAA record (IPv6): `@` or `videograbber` → `2a01:4f8:c014:2805::1`
2. **Configure Caddy with your domain:**

   ```
   yourdomain.com {
       reverse_proxy localhost:3000
   }
   ```
3. **Reload Caddy:**

   ```bash
   sudo systemctl reload caddy
   ```

Caddy will automatically obtain and renew SSL certificates from Let's Encrypt.

---

## Important Notes

- **SSH Keys:** Keep your private keys (`~/.ssh/hetzner_vps` and `~/.ssh/hetzner_madhav`) secure and never share them.
- **Password:** The madhav password (`h6GN7UaqwLBCdnx`) should be changed periodically.
- **Firewall:** Always ensure UFW is enabled and only necessary ports are open.
- **Updates:** Run `sudo apt update && sudo apt upgrade` regularly to keep the system secure.
- **Backups:** Set up regular backups of your Docker volumes and configurations.
- **Monitoring:** Keep an eye on resource usage with `htop` and `docker stats`.

---

## Quick Reference


| Purpose            | Command                       |
| -------------------- | ------------------------------- |
| Connect as root    | `ssh hetzner`                 |
| Connect as madhav  | `ssh hetzner-madhav`          |
| System info        | `fastfetch`                   |
| System resources   | `htop`                        |
| Docker dashboard   | `ctop` or `lazydocker`        |
| View containers    | `docker ps`                   |
| View logs          | `docker compose logs -f`      |
| Restart containers | `docker compose restart`      |
| Firewall status    | `sudo ufw status`             |
| Reload Caddy       | `sudo systemctl reload caddy` |

---

**Last Updated:** November 1, 2025 - 11:50 AM UTC

## Current Setup Status

### ✅ Completed Setup (Production Ready):

**Core Infrastructure:**
1. ✅ SSH keys generated and configured (Ed25519)
2. ✅ Madhav user created with sudo access
3. ✅ UFW firewall enabled (ports: 22, 80, 443, 2377, 7946, 4789)
4. ✅ System fully updated (Ubuntu 24.04.3 LTS, kernel 6.8.0-87)

**Docker Environment:**
5. ✅ Docker v28.5.1 installed and running
6. ✅ Docker Compose v2.40.3 installed
7. ✅ Docker log rotation configured (10MB max, 3 files)

**Reverse Proxy & Networking:**
8. ✅ Caddy v2.10.2 installed (automatic HTTPS)
9. ✅ Project directory structure created (`~/projects`)

**Monitoring & Management:**
10. ✅ htop v3.3.0 (system monitoring)
11. ✅ ctop v0.7.7 (Docker dashboard)
12. ✅ lazydocker (interactive Docker UI)
13. ✅ fastfetch v2.54.0 (system information display)

**Security & Backups:**
14. ✅ fail2ban v1.0.2 enabled (brute force protection)
15. ✅ unattended-upgrades v2.9.1 enabled (automatic security updates)
16. ✅ Automated daily backups configured (2 AM UTC)

### 📋 Remaining Steps (Deploy When Ready):
1. Configure Caddy Caddyfile with your domain(s)
2. Create Docker networks for project isolation
3. Set up persistent storage volumes
4. Deploy your containerized applications
5. Optional: Disable root password login for extra security

**Server is fully configured and ready for production deployments! 🚀**

### 🛠️ Available Tools & Commands:

**System Monitoring:**
- `fastfetch` - Beautiful system information display (OS, CPU, memory, disk, IP)
- `htop` - Interactive system resource monitor
- `ctop` - Real-time Docker container metrics
- `lazydocker` - Terminal UI for Docker management
- `docker stats` - Live container resource usage

**Docker Commands:**
- `docker ps` - List running containers
- `docker compose up -d` - Start services in background
- `docker compose logs -f` - Follow container logs
- `docker network ls` - List Docker networks

**Security & Firewall:**
- `sudo ufw status verbose` - Check firewall status
- `sudo fail2ban-client status` - Check fail2ban status

**Server Management:**
- `df -h` - Check disk usage
- `free -h` - Check memory usage
- `systemctl status caddy` - Check Caddy status
- `systemctl status docker` - Check Docker status
