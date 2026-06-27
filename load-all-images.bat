@echo off
echo 🚀 Loading all Docker images...

cd /d "C:\Project\AI-Powered Call Analysis project\Docker Image"

for %%i in (*.tar) do (
    echo 📦 Loading %%i ...
    docker load -i "%%i"
    
    if %errorlevel%==0 (
        echo ✅ Loaded %%i
    ) else (
        echo ❌ Failed %%i
    )
)

echo 🎉 Done loading all images!
pause