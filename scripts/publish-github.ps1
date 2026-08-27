# Publish mongo-oplog-exporter to GitHub (run in a terminal where `gh auth status` succeeds)
#
# Usage:
#   cd d:\code\cursorcode\mongo-oplog-exporter
#   .\scripts\publish-github.ps1

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))

Write-Host "Checking gh authentication..."
gh auth status
if ($LASTEXITCODE -ne 0) {
    Write-Error "Run 'gh auth login' first and complete the browser flow."
}

if (gh repo view "48N6E/mongo-oplog-exporter" 2>$null) {
    Write-Host "Repository exists. Pushing..."
    git push -u origin main
} else {
    Write-Host "Creating public repository and pushing..."
    gh repo create mongo-oplog-exporter --public --source=. --remote=origin --push
}

Write-Host "Done: https://github.com/48N6E/mongo-oplog-exporter"
