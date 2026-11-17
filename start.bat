@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo  PlusMedik V2 - Servidor local (start.bat)
echo ========================================
echo.

:: Verificar node
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js no está instalado o no está en el PATH.
    echo       Instálalo desde https://nodejs.org/
    pause
    exit /b 1
)

:: Verificar npm
where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm no está disponible.
    pause
    exit /b 1
)

echo [OK] Node.js y npm detectados

:: Ir a la carpeta del proyecto
cd /d "%~dp0"

:: Crear .env si no existe
if not exist ".env" (
    echo.
    echo [INFO] .env no encontrado. Copiando desde .env.example...
    copy ".env.example" ".env" >nul
    echo [IMPORTANTE] Edita el archivo .env y completa tus claves reales:
    echo              - WEBHOOK_SECRET
    echo              - KAPSO_API_KEY y KAPSO_PHONE_NUMBER_ID
    echo              - SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
    echo              - OPENAI_API_KEY y OPENAI_CONVERSATION_MODEL
    echo.
    echo Presiona cualquier tecla para continuar de todos modos...
    pause >nul
) else (
    echo [OK] .env encontrado
)

:: Instalar dependencias si no hay node_modules
if not exist "node_modules" (
    echo.
    echo [INFO] Instalando dependencias (npm install)...
    npm install
    if errorlevel 1 (
        echo [ERROR] Falló npm install
        pause
        exit /b 1
    )
    echo [OK] Dependencias instaladas
) else (
    echo [OK] node_modules presente
)

:: Verificar que TypeScript compila y los tests pasan
echo.
echo [INFO] Verificando proyecto (npm run check)...
npm run check
if errorlevel 1 (
    echo [WARN] El check tuvo errores. Revisa la salida arriba.
    echo.
    echo Presiona cualquier tecla para continuar de todos modos...
    pause >nul
) else (
    echo [OK] Check pasó sin errores
)

:: Mostrar instrucciones de ngrok
echo.
echo ========================================
echo  PASO MANUAL (otra terminal):
echo ========================================
echo  ngrok http 3000 --domain hungerless-uncrystalled-andy.ngrok-free.dev
echo.
echo  Luego registra en Kapso el webhook:
echo    https://hungerless-uncrystalled-andy.ngrok-free.dev/api/kapso/webhook
echo    Secreto: el mismo WEBHOOK_SECRET de tu .env
echo.
echo ========================================
echo  Iniciando servidor local en http://localhost:3000
echo ========================================
echo.

npx tsx dev-server.ts

endlocal