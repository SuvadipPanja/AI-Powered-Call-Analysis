# Run as Administrator — enables TCP for SQLEXPRESS01 on port 1434 (WSL NeMo → SQL)
#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$instanceKey = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\MSSQL16.SQLEXPRESS01\MSSQLServer\SuperSocketNetLib\Tcp"
$port = 1434

Write-Host "Enabling TCP/IP for SQLEXPRESS01 on port $port..." -ForegroundColor Cyan

Set-ItemProperty -Path $instanceKey -Name Enabled -Value 1
Set-ItemProperty -Path "$instanceKey\IPAll" -Name TcpPort -Value "$port"
Set-ItemProperty -Path "$instanceKey\IPAll" -Name TcpDynamicPorts -Value ""

Restart-Service "MSSQL`$SQLEXPRESS01" -Force
Start-Sleep -Seconds 3

New-NetFirewallRule -DisplayName "WSL SQL SQLEXPRESS01 $port" -Direction Inbound `
  -LocalPort $port -Protocol TCP -Action Allow -RemoteAddress 172.16.0.0/12 -ErrorAction SilentlyContinue | Out-Null

Write-Host "Done. SQL listening:" -ForegroundColor Green
netstat -ano | findstr "LISTENING" | findstr ":$port"
Write-Host ""
Write-Host "Restart NeMo: scripts\start-nemo-wsl.bat" -ForegroundColor Yellow
