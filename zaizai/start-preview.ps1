[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3100,
    [switch]$LocalOnly,
    [switch]$NoBrowser,
    [string]$CloudflaredPath = $env:CLOUDFLARED_PATH
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$localUrl = "http://127.0.0.1:$Port"
$serverProcess = $null
$tunnelProcess = $null
$exitCode = 0

function Test-PreviewReady {
    try {
        $response = Invoke-WebRequest -Uri "$localUrl/app.js" -UseBasicParsing -TimeoutSec 2
        $tutorial = Invoke-WebRequest -Uri "$localUrl/tutorial.js" -UseBasicParsing -TimeoutSec 2
        $engine = Invoke-WebRequest -Uri "$localUrl/tutorial-game.js" -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content -ceq $script:expectedApp -and
            $tutorial.StatusCode -eq 200 -and $tutorial.Content -ceq $script:expectedTutorial -and
            $engine.StatusCode -eq 200 -and $engine.Content -ceq $script:expectedEngine
    } catch {
        return $false
    }
}

try {
    $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
    if (-not $node) { throw 'Install Node.js 22 or newer, reopen the terminal, and try again.' }
    $nodeVersion = & $node.Source --version
    if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 22) {
        throw 'Node.js 22 or newer is required.'
    }

    if (-not $LocalOnly) {
        if ($CloudflaredPath) {
            $cloudflared = (Get-Command $CloudflaredPath -CommandType Application -ErrorAction Stop).Source
        } else {
            $command = Get-Command cloudflared.exe -CommandType Application -ErrorAction SilentlyContinue
            if ($command) {
                $cloudflared = $command.Source
            } else {
                $candidates = @(
                    (Join-Path $PSScriptRoot 'cloudflared.exe'),
                    (Join-Path (Split-Path $PSScriptRoot -Parent) '.codex/runtime/cloudflared.exe')
                )
                $cloudflared = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
            }
        }
        if (-not $cloudflared) {
            throw 'cloudflared.exe was not found. See README.md, use -CloudflaredPath, or use -LocalOnly.'
        }
    }

    $runDirectory = Join-Path $PSScriptRoot ('.preview/' + [guid]::NewGuid().ToString('N'))
    [void][System.IO.Directory]::CreateDirectory($runDirectory)
    $script:expectedApp = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'public/app.js'), $utf8)
    $script:expectedTutorial = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'public/tutorial.js'), $utf8)
    $script:expectedEngine = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'server/game.js'), $utf8)

    if (Test-PreviewReady) {
        Write-Host "Reusing the existing ZAIZAI server at $localUrl (it will stay running)."
    } else {
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
            if ($pending.AsyncWaitHandle.WaitOne(500)) {
                try { $client.EndConnect($pending) } catch { }
            }
            if ($client.Connected) {
                throw "Port $Port is occupied by another service or a different app version. Choose another port with -Port (for example, -Port 3200)."
            }
        } finally { $client.Close() }

        $previousPort = $env:PORT
        try {
            $env:PORT = [string]$Port
            $serverProcess = Start-Process -FilePath $node.Source -ArgumentList 'server/index.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runDirectory 'server.stdout.log') -RedirectStandardError (Join-Path $runDirectory 'server.stderr.log')
        } finally { $env:PORT = $previousPort }

        $deadline = [DateTime]::UtcNow.AddSeconds(20)
        while (-not (Test-PreviewReady)) {
            if ($serverProcess.HasExited) { throw "The local server exited. See $runDirectory" }
            if ([DateTime]::UtcNow -gt $deadline) { throw "The local server did not become ready. See $runDirectory" }
            Start-Sleep -Milliseconds 250
        }
    }

    Write-Host "Local preview: $localUrl" -ForegroundColor Green
    Write-Host "Logs: $runDirectory"
    if (-not $NoBrowser) {
        try { Start-Process $localUrl } catch { Write-Warning "Open $localUrl in your browser." }
    }

    if (-not $LocalOnly) {
        # An explicit empty config avoids inheriting a named tunnel configuration.
        $configPath = Join-Path $runDirectory 'quick-tunnel.yml'
        [System.IO.File]::WriteAllText($configPath, "{}`r`n", $utf8)
        $tunnelErrorLog = Join-Path $runDirectory 'tunnel.stderr.log'
        $tunnelOutputLog = Join-Path $runDirectory 'tunnel.stdout.log'
        $tunnelArguments = 'tunnel --config "{0}" --url {1} --no-autoupdate' -f $configPath, $localUrl
        $tunnelProcess = Start-Process -FilePath $cloudflared -ArgumentList $tunnelArguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $tunnelOutputLog -RedirectStandardError $tunnelErrorLog
        Write-Host 'Requesting a temporary trycloudflare URL...'
        $deadline = [DateTime]::UtcNow.AddSeconds(60)
        do {
            if ($tunnelProcess.HasExited) { throw "cloudflared exited. See $tunnelErrorLog" }
            if ($serverProcess -and $serverProcess.HasExited) { throw "The local server exited. See $runDirectory" }
            $log = (Get-Content -LiteralPath $tunnelErrorLog -Encoding UTF8 -Raw -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $tunnelOutputLog -Encoding UTF8 -Raw -ErrorAction SilentlyContinue)
            $publicUrl = [regex]::Match([string]$log, 'https://[a-z0-9-]+[.]trycloudflare[.]com').Value
            if (-not $publicUrl) { Start-Sleep -Milliseconds 500 }
        } while (-not $publicUrl -and [DateTime]::UtcNow -lt $deadline)
        if (-not $publicUrl) { throw "No trycloudflare URL was returned within 60 seconds. See $tunnelErrorLog" }
        Write-Host "Public preview: $publicUrl" -ForegroundColor Green
        Write-Host 'Share the public URL with players. Initial connection may take a few seconds.'
    }

    Write-Host 'Keep this window open. Press Enter to stop the processes started by this script.'
    [void](Read-Host)
} catch {
    Write-Host ("Preview failed: " + $_.Exception.Message) -ForegroundColor Red
    if ($tunnelErrorLog -and (Test-Path -LiteralPath $tunnelErrorLog)) {
        Get-Content -LiteralPath $tunnelErrorLog -Encoding UTF8 -Tail 8 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    }
    if ($serverProcess -and $serverProcess.HasExited) {
        Get-Content -LiteralPath (Join-Path $runDirectory 'server.stderr.log') -Encoding UTF8 -Tail 8 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    }
    $exitCode = 1
} finally {
    foreach ($ownedProcess in @($tunnelProcess, $serverProcess)) {
        if ($ownedProcess -and -not $ownedProcess.HasExited) {
            Stop-Process -Id $ownedProcess.Id -Force -ErrorAction SilentlyContinue
            [void]$ownedProcess.WaitForExit(5000)
        }
    }
}
exit $exitCode
