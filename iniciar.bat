@echo off
title AUDICOM Hub — Servidor Local
chcp 65001 >nul
cls

echo.
echo  AUDICOM Hub — Servidor Local
echo  ================================
echo.

set PORT=8080

:: Tenta o launcher do Python (py.exe — mais confiavel no Windows 11)
py --version >nul 2>&1
if %ERRORLEVEL% == 0 (
    echo  Python encontrado. Iniciando em http://localhost:%PORT%
    echo  Pressione Ctrl+C para parar.
    echo.
    timeout /t 1 /nobreak >nul
    start "" "http://localhost:%PORT%"
    py -m http.server %PORT%
    pause
    goto :fim
)

:: Tenta python
python --version >nul 2>&1
if %ERRORLEVEL% == 0 (
    echo  Python encontrado. Iniciando em http://localhost:%PORT%
    echo  Pressione Ctrl+C para parar.
    echo.
    timeout /t 1 /nobreak >nul
    start "" "http://localhost:%PORT%"
    python -m http.server %PORT%
    pause
    goto :fim
)

:: Tenta Node.js
node --version >nul 2>&1
if %ERRORLEVEL% == 0 (
    echo  Node.js encontrado. Iniciando em http://localhost:%PORT%
    echo  Pressione Ctrl+C para parar.
    echo.
    timeout /t 1 /nobreak >nul
    start "" "http://localhost:%PORT%"
    npx --yes http-server -p %PORT% -c-1 --silent
    pause
    goto :fim
)

echo  ERRO: Python e Node.js nao foram encontrados.
echo.
echo  Instale Python em: https://python.org/downloads
echo  (marque "Add Python to PATH" na instalacao)
echo.
pause

:fim
