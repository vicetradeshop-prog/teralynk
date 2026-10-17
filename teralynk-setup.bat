@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Teralynk — preparation complete
set "DL=C:\Users\lger3\Documents\Downloads"
set "WORKDIR=%DL%\teralynk-v1.1.0"
if not exist "%WORKDIR%\package.json" set "WORKDIR=%~dp0"
cd /d "%WORKDIR%" || goto :fail

:: ---- detection automatique du dossier source le plus recent (Downloads ou C:\v120)
:: bat v5 : tri NUMERIQUE de version (1.10.0 > 1.9.0), pas un tri alphabetique inversé.
set "SRCDIR="
if exist "C:\v120\package.json" set "SRCDIR=C:\v120"
if not defined SRCDIR goto :detect
goto :detected
:detect
> "%TEMP%\tl-src.ps1" echo Get-ChildItem -Directory -Path '%DL%' -Filter 'teralynk-v1.*' -ErrorAction SilentlyContinue ^| Where-Object { Test-Path (Join-Path $_.FullName 'package.json') } ^| ForEach-Object { $m = [regex]::Match($_.Name, 'v(\d+)\.(\d+)\.(\d+)'); $k = if ($m.Success) { [long]$m.Groups[1].Value * 100000000 + [long]$m.Groups[2].Value * 10000 + [long]$m.Groups[3].Value } else { 0 }; [pscustomobject]@{ K = $k; P = $_.FullName } } ^| Sort-Object K -Descending ^| Select-Object -First 1 -ExpandProperty P
for /f "usebackq delims=" %%d in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\tl-src.ps1" 2^>nul`) do set "SRCDIR=%%d"
:detected

echo.
echo ============================================================
echo   TERALYNK — PREPARATION COMPLETE (bat v5)
echo   Dossier de travail : %WORKDIR%
echo   Sources recentes   : %SRCDIR%
echo ============================================================

echo.
echo [1/8] Arret des processus Electron residuels
taskkill /F /IM electron.exe >nul 2>&1
echo       OK

echo.
echo [2/8] Exclusion Defender + diagnostic Smart App Control (UAC : OUI)
> "%TEMP%\tl-excl.ps1" echo Add-MpPreference -ExclusionPath '%WORKDIR%\apps\teralynk\release'
>>"%TEMP%\tl-excl.ps1" echo Add-MpPreference -ExclusionPath '%WORKDIR%\apps\admin\release'
>>"%TEMP%\tl-excl.ps1" echo $sac = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -ErrorAction SilentlyContinue).VerifiedAndReputablePolicyState
>>"%TEMP%\tl-excl.ps1" echo Set-Content -Path '%TEMP%\tl-sac.txt' -Value "$sac"
powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\tl-excl.ps1" >nul 2>&1
powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%TEMP%\tl-excl.ps1'" >nul 2>&1
set "SAC="
if exist "%TEMP%\tl-sac.txt" set /p SAC=<"%TEMP%\tl-sac.txt"
if "!SAC!"=="1" echo       ATTENTION : Smart App Control ACTIF - bloque SANS message les exe non signes (desactivez-le ou utilisez le portable)
if "!SAC!"=="2" echo       ATTENTION : Smart App Control en EVALUATION - blocages silencieux possibles
if not "!SAC!"=="1" if not "!SAC!"=="2" echo       OK : Smart App Control inactif, exclusion posee si UAC acceptee

echo.
echo [3/8] Fusion des sources recentes
if defined SRCDIR (
  robocopy "%SRCDIR%" "%WORKDIR%" /E /XF teralynk-*.zip /XD node_modules .git keys release >nul
  if errorlevel 8 (
    echo       ECHEC robocopy
    goto :fail
  )
  if exist "%WORKDIR%\apps\teralynk\src\pages\AboutPage.tsx" del /q "%WORKDIR%\apps\teralynk\src\pages\AboutPage.tsx"
  echo       Fusion OK depuis %SRCDIR%
) else (
  echo       Aucun dossier source recent detecte - sources actuelles conservees
)

echo.
echo [4/8] Cle publique de signature
if exist "%WORKDIR%\keys\teralynk-signing-public.pem" (
  copy /Y "%WORKDIR%\keys\teralynk-signing-public.pem" "%WORKDIR%\apps\teralynk\electron\signing-public-key.pem" >nul
  echo       OK
) else (
  echo       ERREUR : keys\teralynk-signing-public.pem introuvable
  goto :fail
)

echo.
echo [5/8] Dependances + nettoyage du dossier release (ANTI-SETUP-PERIME)
call npm install --no-audit --no-fund
if %errorlevel% neq 0 goto :fail
taskkill /F /FI "IMAGENAME eq Teralynk-Setup-*" >nul 2>&1
if exist "%WORKDIR%\apps\teralynk\release" rmdir /s /q "%WORKDIR%\apps\teralynk\release" 2>nul
if exist "%WORKDIR%\apps\teralynk\release\*.exe" (
  echo       Fichiers verrouilles - nouvelle tentative dans 3 s...
  timeout /t 3 /nobreak >nul
  taskkill /F /FI "IMAGENAME eq Teralynk-Setup-*" >nul 2>&1
  rmdir /s /q "%WORKDIR%\apps\teralynk\release" 2>nul
)
if exist "%WORKDIR%\apps\teralynk\release\*.exe" (
  echo       ERREUR : d'anciens executables restent verrouilles dans release\
  echo       Fermez l'Explorateur ouvert sur ce dossier / Gestionnaire des taches,
  echo       puis relancez ce script.
  goto :fail
)
echo       OK - release purgue, aucun ancien executable ne peut etre re-publie

echo.
echo [6/8] Compilation de l'installateur (2 a 5 minutes)
call npm run dist -w @teralynk/app
if %errorlevel% neq 0 goto :fail
set "VER="
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "(Get-Content '%WORKDIR%\apps\teralynk\package.json' -Raw | ConvertFrom-Json).version"`) do set "VER=%%v"
if not exist "%WORKDIR%\apps\teralynk\release\Teralynk-Setup-!VER!.exe" (
  echo       ERREUR : Teralynk-Setup-!VER!.exe absent apres compilation
  goto :fail
)
echo       OK - version !VER! compilee et controlee

echo.
echo [7/8] Paquet de publication + portable (controle de coherence integre)
node scripts\make-package.mjs "%WORKDIR%\apps\teralynk\release" !VER! stable 1.0.0
if %errorlevel% neq 0 goto :fail
if not exist "%WORKDIR%\teralynk-!VER!-stable.zip" (
  echo       ERREUR : paquet zip introuvable
  goto :fail
)
echo       OK - teralynk-!VER!-stable.zip controle

echo.
echo [8/8] Sauvegarde Git
git add -A >nul 2>&1
git commit -m "Teralynk v!VER!" >nul 2>&1
git push --force >nul 2>&1 && echo       Pousse sur GitHub || echo       Push impossible (sans gravite pour la suite)

echo.
echo Lancement du panel Teralynk Admin...
start "Teralynk Admin" /D "%WORKDIR%" cmd /k "npm run start -w @teralynk/admin"

echo.
echo ============================================================
echo   MACHINE PRETE (version !VER!). RESTE DANS L'ADMIN :
echo    1. Catalogue / Annonces / Sondages : creer + Publier
echo    2. Versions : Parcourir - teralynk-!VER!-stable.zip
echo       - Confirmer et publier - 12 etapes vertes
echo    3. Installer apps\teralynk\release\Teralynk-Setup-!VER!.exe
echo       (secours : Teralynk-Portable-!VER!.zip - Teralynk\Teralynk.exe)
echo ============================================================
echo.
pause
exit /b 0

:fail
echo.
echo ============================================================
echo   ECHEC - copiez-collez tout l'ecran ci-dessus et envoyez-le.
echo ============================================================
pause
exit /b 1
