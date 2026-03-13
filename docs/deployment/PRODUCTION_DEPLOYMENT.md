# 生产环境部署指南

本文档记录了在 Ubuntu 服务器上部署本项目的完整流程。

## 环境信息

- **操作系统**: Ubuntu 22.04 LTS
- **服务器**: 阿里云
- **域名**: designbyme.cn

## 部署架构

```
用户 → Nginx (80/443) → Frontend (3000)
                        → Gateway (3100) → 后端微服务
                        → WS (3003)     → WebSocket
```

## 服务端口一览

| 服务 | 端口 | 说明 |
|------|------|------|
| Frontend | 3000 | 前端界面 |
| Legacy | 3001 | 主服务 |
| Agents | 3002 | Agent管理服务 |
| WS | 3003 | WebSocket服务 |
| Gateway | 3100 | API网关入口 |
| Engineering Intelligence | 3004 | 研发智能服务 |
| MongoDB | 27017 | 数据库 |
| Redis | 6379 | 缓存 |

---

## 第一步：环境准备

### 1.1 安装基础依赖

```bash
# 更新系统
apt-get update && apt-get upgrade -y

# 安装 Node.js (使用 nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 18

# 安装 Docker (如需容器化部署)
apt-get install -y docker.io docker-compose

# 安装 Nginx
apt-get install -y nginx
```

### 1.2 安装 Certbot (Let's Encrypt)

```bash
apt-get install -y certbot python3-certbot-nginx
```

---

## 第二步：数据库配置

### 2.1 使用 Docker 部署数据库

创建 `docker-compose.yml`:

```yaml
version: '3.8'

services:
  mongodb:
    image: mongo:7
    container_name: mongodb
    ports:
      - "27017:27017"
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: goodluck@123
    volumes:
      - mongodb_data:/data/db
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: redis
    ports:
      - "6379:6379"
    command: redis-server --requirepass goodluck@123
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  mongodb_data:
  redis_data:
```

启动数据库:

```bash
docker-compose up -d
```

### 2.2 配置后端环境变量

创建 `backend/.env`:

```env
# MongoDB (注意 authSource=admin)
MONGODB_URI=mongodb://admin:goodluck%40123@localhost:27017/harbin?authSource=admin

# Redis (密码需要 URL 编码)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=goodluck%40123

# 其他配置...
```

---

## 第三步：启动后端服务

### 3.1 安装依赖

```bash
cd backend
npm run install:all
```

### 3.2 启动各个微服务

```bash
# 方式一：使用启动脚本
./start.sh development

# 方式二：手动启动各个服务
cd backend

# Legacy (端口 3001)
pnpm run start:legacy -- --watch &

# Gateway (端口 3100)
pnpm run start:gateway -- --watch &

# Agents (端口 3002)
pnpm run start:agents -- --watch &

# WS (端口 3003)
pnpm run start:ws -- --watch &

# Engineering Intelligence (端口 3004)
pnpm run start:ei -- --watch &
```

### 3.3 验证后端服务

```bash
# 检查端口监听
ss -tlnp | grep -E "3001|3002|3003|3004|3100"

# 测试 API
curl http://localhost:3100
```

---

## 第四步：启动前端服务

### 4.1 安装依赖

```bash
cd frontend
npm install
```

### 4.2 修改 Vite 配置

编辑 `frontend/vite.config.ts`，添加允许的域名:

```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    allowedHosts: ['designbyme.cn', 'www.designbyme.cn'],
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true
      }
    }
  }
})
```

### 4.3 启动前端

```bash
cd frontend
pnpm dev &
```

---

## 第五步：配置 Nginx 反向代理

### 5.1 编辑 Nginx 配置

编辑 `/etc/nginx/sites-available/default`:

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name _;

    # Frontend
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket proxy
    location /ws/ {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }

    # Backend API proxy (to gateway)
    location /api/ {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 5.2 测试并重载 Nginx

```bash
nginx -t
systemctl reload nginx
```

---

## 第六步：配置 HTTPS (Let's Encrypt)

### 6.1 创建 SSL 证书

```bash
# 确保域名已解析到服务器 IP
certbot --nginx -d designbyme.cn --non-interactive --agree-tos --email your-email@example.com
```

### 6.2 验证 HTTPS

```bash
curl https://designbyme.cn
```

### 6.3 自动续期

Certbot 会自动配置续期任务。可手动测试:

```bash
certbot renew --dry-run
```

---

## 启动脚本

创建 `start.sh` 方便一键启动:

```bash
#!/bin/bash

# 启动 Docker 服务
docker-compose up -d

# 等待数据库就绪
sleep 5

# 启动后端服务
cd backend
pnpm run start:legacy -- --watch &
pnpm run start:gateway -- --watch &
pnpm run start:agents -- --watch &
pnpm run start:ws -- --watch &
pnpm run start:ei -- --watch &

# 启动前端
cd ../frontend
pnpm dev &

echo "所有服务已启动"
```

---

## 验证清单

- [ ] MongoDB 正常运行 (端口 27017)
- [ ] Redis 正常运行 (端口 6379)
- [ ] 所有后端微服务运行中
- [ ] 前端服务运行中 (端口 3000)
- [ ] Nginx 反向代理正常
- [ ] HTTPS 证书已配置
- [ ] 域名解析正常

---

## 常用命令

```bash
# 查看所有运行中的服务端口
ss -tlnp | grep -E "3000|3001|3002|3003|3004|3100"

# 查看 Docker 容器状态
docker-compose ps

# 查看 Nginx 状态
systemctl status nginx

# 查看证书信息
certbot certificates

# 重启 Nginx
systemctl restart nginx

# 查看日志
tail -f /var/log/nginx/error.log
```

---

## 常见问题

### 1. MongoDB 连接失败

确保连接字符串包含 `?authSource=admin`:

```env
MONGODB_URI=mongodb://admin:password@localhost:27017/db?authSource=admin
```

### 2. Redis 连接失败

密码中的特殊字符需要 URL 编码:

- `@` → `%40`
- `/` → `%2F`

### 3. 前端 403 错误

在 `vite.config.ts` 中添加 `allowedHosts`:

```typescript
server: {
  allowedHosts: ['your-domain.com'],
  // ...
}
```
