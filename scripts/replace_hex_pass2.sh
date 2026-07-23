#!/bin/bash
cd /app/frontend/src/components || exit 1

declare -A MAP=(
  # Second pass — remaining hex codes
  ["'#0F172A'"]="'var(--text-primary)'"
  ["'#0F766E'"]="'var(--success)'"
  ["'#0369A1'"]="'var(--info)'"
  ["'#0A6ED1'"]="'var(--primary-blue)'"
  ["'#FCA5A5'"]="'var(--danger-border)'"
  ["'#F0FDF4'"]="'var(--success-bg)'"
  ["'#FFF5F5'"]="'var(--danger-bg)'"
  ["'#FCD34D'"]="'var(--warning)'"
  ["'#F8FAF9'"]="'var(--bg-subtle)'"
  ["'#F7F5F0'"]="'var(--bg-app)'"
  ["'#FAF6EE'"]="'var(--bg-app)'"
  ["'#FFFDF5'"]="'var(--bg-app)'"
  ["'#EFF2F6'"]="'var(--bg-subtle)'"
  ["'#EFF3F6'"]="'var(--bg-subtle)'"
  ["'#EFF6FC'"]="'var(--info-bg)'"
  ["'#F0F9FF'"]="'var(--info-bg)'"
  ["'#F0F7FF'"]="'var(--info-bg)'"
  ["'#DCEFEA'"]="'var(--success-bg)'"
  ["'#E5DED0'"]="'var(--border-color)'"
  ["'#E5DEC9'"]="'var(--border-color)'"
  ["'#DFB26C'"]="'var(--accent)'"
  ["'#D4AF37'"]="'var(--accent)'"
  ["'#BCE3E2'"]="'var(--success-border)'"
  ["'#A0B2C6'"]="'var(--text-disabled)'"
  ["'#888'"]="'var(--text-muted)'"
  ["'#7C3AED'"]="'var(--info)'"
  ["'#235E52'"]="'var(--primary-blue)'"
  ["'#1D4ED8'"]="'var(--info)'"
  ["'#C2410C'"]="'var(--warning)'"
  ["'#D04900'"]="'var(--warning)'"
  ["'#C4B5FD'"]="'var(--info-border)'"
  ["'#8AAAC8'"]="'var(--text-muted)'"
  ["'#4F5E80'"]="'var(--text-secondary)'"
  ["'#32363A'"]="'var(--text-primary)'"
  ["'#107E3E'"]="'var(--success)'"
  ["'#047857'"]="'var(--success)'"
)

for FILE in *.jsx; do
  for KEY in "${!MAP[@]}"; do
    VAL="${MAP[$KEY]}"
    perl -i -pe "s/\Q$KEY\E/$VAL/g" "$FILE"
  done
done

echo "Remaining after pass 2:"
grep -rEoh "'#[0-9A-Fa-f]{3,8}'" *.jsx | sort | uniq -c | sort -rn
