@echo off
cd /d "P:\Projects\cometchat-sample-app\android"
call gradlew.bat installDebug -PreactNativeArchitectures=arm64-v8a --console=plain > "%~dp0build-install.log" 2>&1
echo EXITCODE=%ERRORLEVEL% >> "%~dp0build-install.log"
