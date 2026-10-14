FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home estoque && mkdir /data && chown estoque /data
COPY --chown=estoque:estoque app.py ./
COPY --chown=estoque:estoque static ./static
USER estoque
ENV DATABASE_PATH=/data/estoque.sqlite3 PORT=8000 COOKIE_SECURE=true
EXPOSE 8000
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT:-8000} --workers 2 --threads 4 --timeout 30 'app:create_app()'"]
