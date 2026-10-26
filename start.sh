#!/usr/bin/env bash
# LEGT AI başlatıcı (Linux / macOS)
# Kullanım: ./start.sh [dev|build|preview|test|typecheck|dist] [--yes]   (varsayılan: dev)
#   --yes   Ollama kurulumu ve model indirme sorularını otomatik onayla
set -euo pipefail

# VS Code terminalleri bunu devralır; ayarlıyken Electron düz Node gibi çalışır
unset ELECTRON_RUN_AS_NODE

cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")"

CMD="dev"
ASSUME_YES="${LEGT_YES:-0}"
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    *) CMD="$arg" ;;
  esac
done

OLLAMA_URL="http://localhost:11434"
RECOMMENDED_MODEL="qwen2.5-coder:7b"

ask() { # ask "Soru" -> 0 = evet
  [ "$ASSUME_YES" = "1" ] && return 0
  [ -t 0 ] || return 1
  read -r -p "$1 [E/h] " reply
  case "${reply:-e}" in [eEyY]*) return 0 ;; *) return 1 ;; esac
}

ollama_up() { curl -s -m 2 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; }

ensure_ollama() {
  if ! command -v ollama >/dev/null 2>&1; then
    echo ">> Ollama bulunamadı."
    if ask "Ollama şimdi kurulsun mu? (ollama.com resmi kurulum betiği, sudo isteyebilir)"; then
      case "$(uname -s)" in
        Linux)
          command -v curl >/dev/null 2>&1 || { echo "HATA: curl gerekli (sudo apt install curl)" >&2; return 1; }
          curl -fsSL https://ollama.com/install.sh | sh
          ;;
        Darwin)
          if command -v brew >/dev/null 2>&1; then
            brew install ollama
          else
            echo "macOS'ta Homebrew yok. Ollama'yı https://ollama.com/download adresinden kurun, sonra tekrar çalıştırın."
            return 1
          fi
          ;;
        *)
          echo "Bu sistem için otomatik kurulum yok: https://ollama.com/download"
          return 1
          ;;
      esac
    else
      echo "Not: Ollama kurulmadı. LM Studio / llama.cpp gibi başka bir yerel sunucuyu Ayarlar'dan bağlayabilirsiniz."
      return 0
    fi
  fi

  if ! ollama_up; then
    echo ">> Ollama servisi başlatılıyor..."
    if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files ollama.service >/dev/null 2>&1; then
      sudo systemctl start ollama 2>/dev/null || true
    fi
    if ! ollama_up; then
      mkdir -p projects
      nohup ollama serve >projects/ollama.log 2>&1 &
    fi
    for _ in $(seq 1 15); do ollama_up && break; sleep 1; done
    ollama_up || { echo "Uyarı: Ollama başlatılamadı (projects/ollama.log)."; return 0; }
  fi

  if ! ollama list 2>/dev/null | grep -qi "coder"; then
    echo ">> Kod odaklı bir model bulunamadı (7B+ önerilir)."
    if ask "Önerilen model indirilsin mi? ($RECOMMENDED_MODEL, ~4.7 GB)"; then
      ollama pull "$RECOMMENDED_MODEL"
    fi
  fi
}

if ! command -v node >/dev/null 2>&1; then
  echo "HATA: Node.js bulunamadı. Node 20 veya üzerini kurun: https://nodejs.org" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "HATA: Node $NODE_MAJOR bulundu, en az Node 20 gerekli." >&2
  exit 1
fi

if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo ">> Bağımlılıklar kuruluyor..."
  npm install
  touch node_modules
fi

# php -l: önce runtime/ altındaki portable PHP (uygulama da bunu kullanır), yoksa PATH
if [ -x runtime/xampp/php/php ] || [ -f runtime/xampp/php/php.exe ]; then
  echo "PHP doğrulaması: runtime/xampp/php"
elif ! command -v php >/dev/null 2>&1; then
  echo "Not: PHP bulunamadı. 'npm run setup:runtime' (ya da LEGT_XAMPP_DIR) ile kurulursa php -l ve canlı test onu kullanır; o zamana kadar PHP dosyaları basit kontrolle doğrulanır."
fi

case "$CMD" in
  dev|preview) ensure_ollama || true ;;
esac

case "$CMD" in
  dev|build|preview|test|typecheck|dist)
    exec npm run "$CMD"
    ;;
  *)
    echo "Bilinmeyen komut: $CMD"
    echo "Kullanım: ./start.sh [dev|build|preview|test|typecheck|dist] [--yes]"
    exit 1
    ;;
esac
