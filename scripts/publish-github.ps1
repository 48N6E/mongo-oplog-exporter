# Publish mongo-oplog-exporter to GitHub (run in a terminal where `gh auth status` succeeds)
#
# Usage:
#   cd path\to\mongo-oplog-exporter
#   .\scripts\publish-github.ps1

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))

Write-Host "Checking gh authentication..."
gh auth status
if ($LASTEXITCODE -ne 0) {
    Write-Error "Run 'gh auth login' first and complete the browser flow."
}

$repoName = "mongo-oplog-exporter"
$remoteUrl = git remote get-url origin 2>$null

if ($remoteUrl -and (gh repo view 2>$null)) {
    Write-Host "Repository exists. Pushing..."
    git push -u origin main
} else {
    Write-Host "Creating public repository and pushing..."
    gh repo create $repoName --public --source=. --remote=origin --push
}

Write-Host "Done."
