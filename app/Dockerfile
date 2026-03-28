FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8765

WORKDIR /srv/app

COPY requirements.txt .
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-client sshpass shfmt \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY . .

RUN mkdir -p /workspace/skills \
    && chmod +x /srv/app/scripts/*.sh

EXPOSE 8765

CMD ["sh", "-c", "exec gunicorn -b 0.0.0.0:${PORT:-8765} app:app"]
