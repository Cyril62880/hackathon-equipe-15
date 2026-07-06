#!/bin/bash

set -e

while true; do
  ./scripts/export-security-reports.sh
  echo "Prochain export dans 1 heure..."
  sleep 3600
done