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
| **Kernel**            | 6.8.0-71-generic x86_64     |
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

### Firewall Configuration (As Madhav)

```bash
# Enable SSH access through firewall
sudo ufw allow OpenSSH
# Password entered: h6GN7UaqwLBCdnx

# Allow HTTP traffic (port 80)
sudo ufw allow 80/tcp
```

---

## Additional Setup for Container-Based Projects

To properly set up the VPS for hosting multiple containerized projects (like video-grabber and others), follow these steps:

### 1. Enable and Configure UFW Firewall

```bash
# Allow HTTPS traffic (port 443)
sudo ufw allow 443/tcp

# Allow Docker networking (if using Swarm)
sudo ufw allow 2377/tcp
sudo ufw allow 7946/tcp
sudo ufw allow 7946/udp
sudo ufw allow 4789/udp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status verbose
```

### 2. Update and Upgrade System

```bash
sudo apt update
sudo apt upgrade -y
sudo apt autoremove -y
```

### 3. Install Docker and Docker Compose

```bash
# Install prerequisites
sudo apt install -y apt-transport-https ca-certificates curl software-properties-common

# Add Docker's official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Add Docker repository
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add madhav to docker group (no sudo needed for docker commands)
sudo usermod -aG docker madhav

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Verify installation
docker --version
docker compose version
```

**Note:** Log out and log back in for docker group changes to take effect.

### 4. Install Reverse Proxy (Caddy or Nginx)

#### Option A: Caddy (Recommended - Automatic HTTPS)

```bash
# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy

# Caddy will automatically get SSL certificates from Let's Encrypt
```

**Example Caddyfile for multiple projects** (`/etc/caddy/Caddyfile`):

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

#### Option B: Nginx + Certbot

```bash
# Install Nginx
sudo apt install -y nginx

# Install Certbot for SSL
sudo apt install -y certbot python3-certbot-nginx

# Example Nginx config for multiple projects
# Create separate config files in /etc/nginx/sites-available/
```

### 5. Set Up Project Directory Structure

```bash
# Create projects directory
mkdir -p ~/projects
cd ~/projects

# Create individual project directories
mkdir -p ~/projects/video-grabber
mkdir -p ~/projects/project2
mkdir -p ~/projects/project3

# Set proper permissions
chmod -R 755 ~/projects
```

### 6. Configure Docker Networks

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

### 7. Set Up Persistent Storage

```bash
# Create volumes directory for persistent data
sudo mkdir -p /var/docker-volumes
sudo chown -R madhav:madhav /var/docker-volumes

# Create project-specific volume directories
mkdir -p /var/docker-volumes/video-grabber
mkdir -p /var/docker-volumes/project2
```

### 8. Install Monitoring Tools (Optional but Recommended)

```bash
# Install htop for system monitoring
sudo apt install -y htop

# Install Docker stats dashboard (ctop)
sudo wget https://github.com/bcicen/ctop/releases/download/v0.7.7/ctop-0.7.7-linux-amd64 -O /usr/local/bin/ctop
sudo chmod +x /usr/local/bin/ctop

# Install Docker container monitoring (lazydocker)
curl https://raw.githubusercontent.com/jesseduffield/lazydocker/master/scripts/install_update_linux.sh | bash
```

### 9. Set Up Automatic Backups (Optional)

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

### 10. Security Best Practices

```bash
# Disable root password login (SSH key only)
sudo sed -i 's/#PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# Install fail2ban for brute force protection
sudo apt install -y fail2ban
sudo systemctl start fail2ban
sudo systemctl enable fail2ban

# Set up automatic security updates
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### 11. Configure Log Rotation for Docker

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

# Restart Docker
sudo systemctl restart docker
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
| View containers    | `docker ps`                   |
| View logs          | `docker compose logs -f`      |
| Restart containers | `docker compose restart`      |
| System resources   | `htop`                        |
| Firewall status    | `sudo ufw status`             |
| Reload Caddy       | `sudo systemctl reload caddy` |

---

**Last Updated:** November 1, 2025
