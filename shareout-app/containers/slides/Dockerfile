# Slide decks → PDF for /v1/home/import (src/pages/home/import-slides.ts).
# Headless LibreOffice Impress behind a tiny stdlib HTTP server on :8080.
# Pinned: dated Debian snapshot tag; LibreOffice comes from that release's archive.
FROM debian:trixie-20260918-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-impress python3 \
      fonts-dejavu-core fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 convert

COPY server.py /srv/server.py
USER convert
EXPOSE 8080
CMD ["python3", "/srv/server.py"]
