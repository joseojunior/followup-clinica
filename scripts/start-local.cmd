@echo off
setlocal
cd /d "%~dp0.."
echo Iniciando Follow-up Clinica em http://localhost:3000
call npm run dev -- --port 3000
