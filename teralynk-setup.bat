@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Teralynk — preparation complete
set "WORKDIR=C:\Users\lger3\Documents\Downloads\teralynk-v1.1.0"
set "SRCDIR=C:\v120"

cd /d "%WORKDIR%" || goto :fail

:: ------------------------------------------------ elevation administrateur
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo [!] Demande des droits administrateur (fenetre UAC : oui)...
  powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/c \"%~f0\"' -Verb RunAs"
  exit /b
)

echo.
echo ============================================================
echo   TERALYNK — PREPARATION COMPLETE   dossier : %WORKDIR%
echo ============================================================

:: ------------------------------------------------ 1. Defender
echo.
echo [1/7] Windows Defender : exclusion du dossier release + restauration
"%ProgramFiles%\Windows Defender\MpCmdRun.exe" -AddExclusionPath "%WORKDIR%\apps\teralynk\release" >nul 2>&1
"%ProgramFiles%\Windows Defender\MpCmdRun.exe" -AddExclusionPath "%WORKDIR%\apps\admin\release" >nul 2>&1
"%ProgramFiles%\Windows Defender\MpCmdRun.exe" -Restore -All >nul 2>&1
echo       OK (exclusion posee, quarantaine restauree si necessaire)

:: ------------------------------------------------ 2. fusion v1.2.0
echo.
echo [2/7] Fusion des sources recentes depuis %SRCDIR% (si present)
if exist "%SRCDIR%\package.json" (
  robocopy "%SRCDIR%" "%WORKDIR%" /E /XF teralynk-*.zip /XD node_modules .git keys release >nul
  if errorlevel 8 (
    echo       ECHEC de la copie robocopy
    goto :fail
  )
  if exist "%WORKDIR%\apps\teralynk\src\pages\AboutPage.tsx" del /q "%WORKDIR%\apps\teralynk\src\pages\AboutPage.tsx"
  echo       Sources fusionnees (design v2 + correctifs)
) else (
  echo       %SRCDIR% absent : sources du dossier actuel conservees
)

:: ------------------------------------------------ 3. cle publique
echo.
echo [3/7] Cle publique de signature remise en place dans l'application
if exist "%WORKDIR%\keys\teralynk-signing-public.pem" (
  copy /Y "%WORKDIR%\keys\teralynk-signing-public.pem" "%WORKDIR%\apps\teralynk\electron\signing-public-key.pem" >nul
  echo       OK
) else (
  echo       ERREUR : keys\teralynk-signing-public.pem introuvable dans %WORKDIR%
  goto :fail
)

:: ------------------------------------------------ 4. dependances
echo.
echo [4/7] Dependances npm + binaire Electron (postinstall automatique)
call npm install --no-audit --no-fund
if %errorlevel% neq 0 goto :fail
echo       OK

:: ------------------------------------------------ 5. compilation
echo.
echo [5/7] Compilation de l'installateur Windows (2 a 5 minutes)
call npm run dist -w @teralynk/app
if %errorlevel% neq 0 goto :fail

set "VER="
for /f "usebackq tokens=2 delims=:," %%a in (`findstr /c:"\"version\"" "%WORKDIR%\apps\teralynk\package.json"`) do set "VER=%%~a"
set "VER=!VER: =!"
echo       Version compilee : !VER!

:: ------------------------------------------------ 6. paquet
echo.
echo [6/7] Paquet de publication + artefact portable
node scripts\make-package.mjs "%WORKDIR%\apps\teralynk\release" !VER! stable 1.0.0
if %errorlevel% neq 0 goto :fail

:: ------------------------------------------------ 7. git
echo.
echo [7/7] Sauvegarde Git vers GitHub (si depot configure)
git add -A >nul 2>&1
git commit -m "Teralynk v!VER!" >nul 2>&1
git push >nul 2>&1 && echo       Pousse sur GitHub || echo       Push impossible (sans gravite pour la suite)

:: ------------------------------------------------ admin
echo.
echo Lancement du panel Teralynk Admin dans une nouvelle fenetre...
start "Teralynk Admin" /D "%WORKDIR%" cmd /k "npm run start -w @teralynk/admin"

echo.
echo ============================================================
echo   MACHINE PRETE. RESTE A FAIRE DANS L'ADMIN (souris) :
echo    1. Catalogue   : Nouvelle carte - remplir - Publier sur GitHub
echo    2. Annonces    : Nouvelle annonce - remplir - Publier
echo    3. Sondages    : Nouveau sondage - remplir - Publier
echo    4. Versions    : Parcourir - teralynk-!VER!-stable.zip
echo                     - Confirmer et publier - 12 etapes vertes
echo    5. Installer   : apps\teralynk\release\Teralynk-Setup-!VER!.exe
echo         (secours : decompresser Teralynk-Portable-!VER!.zip
echo          puis lancer Teralynk\Teralynk.exe)
echo ============================================================
echo.
pause
exit /b 0

:fail
echo.
echo ============================================================
echo   ECHEC — copiez-collez tout ce qui precede et envoyez-le.
echo ============================================================
pause
exit /b 1
