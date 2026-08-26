#Requires -Version 5.1
# Legacy delegating wrapper for forge-launcher.
# The canonical implementation is the Node npm package at scripts/forge-launcher/.
# This wrapper keeps existing invocations working during the transition and is
# scheduled for removal (see ADR-023).

$PkgDir = Join-Path $PSScriptRoot "forge-launcher"

function Invoke-Forge {
    $distCli = Join-Path $PkgDir "dist\cli.js"
    if (Test-Path $distCli -PathType Leaf) {
        & node $distCli @Args
        exit $LASTEXITCODE
    }
    $tsxLocal = Join-Path $PkgDir "node_modules\.bin\tsx"
    $tsxGlobal = Get-Command tsx -ErrorAction SilentlyContinue
    if (Test-Path $tsxLocal) {
        & $tsxLocal (Join-Path $PkgDir "scripts\cli.ts") @Args
        exit $LASTEXITCODE
    }
    if ($tsxGlobal) {
        & $tsxGlobal.Source (Join-Path $PkgDir "scripts\cli.ts") @Args
        exit $LASTEXITCODE
    }
    Write-Error "forge-launcher: package not built. Run in scripts\forge-launcher\: npm install; npm run build"
    exit 1
}

Invoke-Forge
