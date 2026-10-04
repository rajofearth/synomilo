@echo off
cd /d "P:\Projects\cometchat-sample-app\android"
call gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain > "%~dp0release-build.log" 2>&1
echo EXITCODE=%ERRORLEVEL% >> "%~dp0release-build.log"
