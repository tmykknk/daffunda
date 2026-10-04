#!/bin/sh
set -eu

gitleaks_version=8.30.1
gitleaks_dir=$(mktemp -d)
trap 'rm -rf "$gitleaks_dir"' EXIT HUP INT TERM
gitleaks_archive="gitleaks_${gitleaks_version}_linux_x64.tar.gz"
gitleaks_base="https://github.com/gitleaks/gitleaks/releases/download/v${gitleaks_version}"
curl -fsSL "$gitleaks_base/$gitleaks_archive" -o "$gitleaks_dir/$gitleaks_archive"
curl -fsSL "$gitleaks_base/gitleaks_${gitleaks_version}_checksums.txt" -o "$gitleaks_dir/checksums.txt"
(cd "$gitleaks_dir"; awk -v archive="$gitleaks_archive" '$2 == archive {print}' checksums.txt | sha256sum -c -)
tar -xzf "$gitleaks_dir/$gitleaks_archive" -C "$gitleaks_dir" gitleaks
"$gitleaks_dir/gitleaks" git --redact --log-opts="--all" .
