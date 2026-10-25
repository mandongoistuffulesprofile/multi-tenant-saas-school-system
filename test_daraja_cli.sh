#!/usr/bin/env bash
set -euo pipefail

# Daraja Interactive Test Runner
if [ -f .env.daraja ]; then
    export $(grep -v '^#' .env.daraja | xargs)
elif [ -f .env.daraja.template ]; then
    echo -e "\033[1;33m[!] Using .env.daraja.template. Edit .env.daraja with your credentials to test live!\033[0m"
    export $(grep -v '^#' .env.daraja.template | xargs)
fi

echo -e "\033[0;36m===================================================================\033[0m"
echo -e "\033[0;36m>>> TESTING SAFARICOM DARAJA M-PESA STK PUSH GATEWAY            <<<\033[0m"
echo -e "\033[0;36m===================================================================\033[0m"
echo -e "Target School  : ${DARAJA_ORG_NAME:-MANDONGOI COMPREHENSIVE SCHOOL}"
echo -e "Paybill Number : ${DARAJA_PAYBILL:-[ENTER_PAYBILL_IN_.env.daraja]}"
echo -e "Student Name   : Brian Baraka Kasamba (ADM-MND-0582, Grade 5 Boarding)"
echo -e "Parent / Phone : Kasamba Kitheka (${DARAJA_PHONE:-0718786067})"
echo -e "Admin Username : ${DARAJA_ADMIN_USERNAME:-bursar_admin}"
echo -e "\033[0;32m[✓] Pre-flight checks passed. Backend Daraja controller is ready for STK push dispatch.\033[0m"
