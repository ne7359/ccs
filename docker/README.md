<div align="center">

# CCS Dashboard - Docker

![CCS Logo](../assets/ccs-logo-medium.png)

### Run the CCS Config Dashboard in Docker.
Persistent config, restart on reboot.

**[Back to README](../README.md)**

</div>

<br>

## Quick Start (Prebuilt Image)

Pull the latest stable release image from GitHub Container Registry:

```bash
docker run -d \
  --name ccs-dashboard \
  --restart unless-stopped \
  -p 3000:3000 \
  -p 8317:8317 \
  -e CCS_PORT=3000 \
  -v ccs_home:/home/node/.ccs \
  ghcr.io/kaitranntt/ccs-dashboard:latest
```

Release-tag images are also published as `ghcr.io/kaitranntt/ccs-dashboard:<version>`.

## Build Locally

```bash
docker build -f docker/Dockerfile -t ccs-dashboard:latest .
docker run -d \
  --name ccs-dashboard \
  --restart unless-stopped \
  -p 3000:3000 \
  -p 8317:8317 \
  -e CCS_PORT=3000 \
  -v ccs_home:/home/node/.ccs \
  ccs-dashboard:latest
```

Open `http://localhost:3000` (Dashboard).

CCS also starts CLIProxy on `http://localhost:8317` (used by Dashboard features and OAuth providers).

## Environment Variables

Common CCS environment variables (from the docs):

- Docs: [Environment variables](https://docs.ccs.kaitran.ca/getting-started/configuration#environment-variables)

- `CCS_CONFIG`: override config file path
- `CCS_UNIFIED_CONFIG=1`: force unified YAML config loader
- `CCS_MIGRATE=1`: trigger config migration
- `CCS_SKIP_MIGRATION=1`: skip migrations
- `CCS_DEBUG=1`: enable verbose logs
- `NO_COLOR=1`: disable ANSI colors
- `CCS_SKIP_PREFLIGHT=1`: skip API key validation checks
- `CCS_WEBSEARCH_SKIP=1`: skip WebSearch hook integration
- Proxy: `CCS_PROXY_HOST`, `CCS_PROXY_PORT`, `CCS_PROXY_PROTOCOL`, `CCS_PROXY_AUTH_TOKEN`, `CCS_PROXY_TIMEOUT`, `CCS_PROXY_FALLBACK_ENABLED`, `CCS_ALLOW_SELF_SIGNED`

Example (passing env vars to the running container):

```bash
docker run -d \
  --name ccs-dashboard \
  --restart unless-stopped \
  -p 3000:3000 \
  -p 8317:8317 \
  -e CCS_PORT=3000 \
  -e CCS_DEBUG=1 \
  -e NO_COLOR=1 \
  -e CCS_PROXY_HOST="proxy.example.com" \
  -e CCS_PROXY_PORT=443 \
  -e CCS_PROXY_PROTOCOL="https" \
  -v ccs_home:/home/node/.ccs \
  ccs-dashboard:latest
```

## Useful Commands

```bash
docker logs -f ccs-dashboard
docker stop ccs-dashboard
docker start ccs-dashboard
docker rm -f ccs-dashboard
```

## Docker Compose (Optional)

Using the included `docker/docker-compose.yml`:

```bash
docker-compose -f docker/docker-compose.yml up --build -d
docker-compose -f docker/docker-compose.yml logs -f
```

Stop:

```bash
docker-compose -f docker/docker-compose.yml down
```

## Persistence

- CCS stores data in `/home/node/.ccs` inside the container.
- The examples use a named volume (`ccs_home`) to persist that data.
- Compose also persists `/home/node/.claude`, `/home/node/.opencode`, and `/home/node/.grok-cli` via named volumes.

## Resource Limits

For production deployments, limit container resources:

```bash
docker run -d \
  --name ccs-dashboard \
  --restart unless-stopped \
  --memory=1g \
  --cpus=2 \
  -p 3000:3000 \
  -p 8317:8317 \
  -v ccs_home:/home/node/.ccs \
  ccs-dashboard:latest
```

Docker Compose includes default limits (1GB RAM, 2 CPUs). Adjust in `docker-compose.yml` under `deploy.resources`.

## Graceful Shutdown

CCS handles `SIGTERM` gracefully. When stopping the container:

```bash
docker stop ccs-dashboard        # Sends SIGTERM, waits 10s, then SIGKILL
docker stop -t 30 ccs-dashboard  # Wait 30s for graceful shutdown
```

The `init: true` in docker-compose.yml ensures proper signal forwarding.

## Troubleshooting

### Permission Errors (EACCES)

If you see permission errors on startup:

```bash
# Check volume permissions
docker exec ccs-dashboard ls -la /home/node/.ccs

# Fix by recreating volumes
docker-compose down -v
docker-compose up -d
```

### Port Already in Use

```bash
# Check what's using the port
lsof -i :3000
lsof -i :8317

# Use different ports
docker run -p 4000:3000 -p 9317:8317 ...

# Or with compose
CCS_DASHBOARD_PORT=4000 CCS_CLIPROXY_PORT=9317 docker-compose up -d
```

### Container Keeps Restarting

```bash
# Check logs for errors
docker logs ccs-dashboard --tail 50

# Check container health
docker inspect ccs-dashboard --format='{{.State.Health.Status}}'
```

### Debug Mode

Enable verbose logging:

```bash
docker run -e CCS_DEBUG=1 ...
```

## Examples: Claude + Gemini inside Docker

Open a shell inside the running container:

```bash
docker exec -it ccs-dashboard bash
```

Claude (non-interactive / print mode):

```bash
docker exec -it ccs-dashboard claude -p "Hello from Docker"
```

Gemini (one-shot prompt):

```bash
docker exec -it ccs-dashboard gemini "Hello from Docker"
```

If you need to configure credentials, do it according to each CLI's docs:

```bash
docker exec -it ccs-dashboard claude --help
docker exec -it ccs-dashboard gemini --help
```

## Security Notes

- **Secrets**: For sensitive values like `CCS_PROXY_AUTH_TOKEN`, consider using Docker secrets or a `.env` file (not committed to git).
- **Network**: The container exposes ports 3000 and 8317. In production, use a reverse proxy (nginx, traefik) with TLS.
- **Updates**: Regularly rebuild the image to get security patches: `docker-compose build --pull`
