@echo off
title Cantinho do Bebe PDV — Gerando Instalador
color 0A
echo.
echo  ================================================
echo   Cantinho do Bebe PDV — Build do Instalador
echo  ================================================
echo.

:: Verifica se Node.js esta instalado
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo  [ERRO] Node.js nao encontrado!
    echo.
    echo  Instale o Node.js em: https://nodejs.org
    echo  Escolha a versao LTS (recomendada).
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  Node.js encontrado: %NODE_VER%

:: Verifica se npm esta disponivel
where npm >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo  [ERRO] npm nao encontrado. Reinstale o Node.js.
    pause
    exit /b 1
)

echo  Instalando dependencias...
echo.
call npm install
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo  [ERRO] Falha ao instalar dependencias.
    pause
    exit /b 1
)

echo.
echo  Gerando instalador Windows (.exe)...
echo.
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm run build:win
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo  [ERRO] Falha ao gerar o instalador.
    echo  Verifique se todos os arquivos estao presentes.
    pause
    exit /b 1
)

echo.
color 0A
echo  ================================================
echo   Instalador gerado com sucesso!
echo   Pasta: dist\
echo   Arquivo: Cantinho-do-Bebe-PDV-Instalador.exe
echo  ================================================
echo.
explorer dist
pause
