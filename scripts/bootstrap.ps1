#Requires -Version 5.1
# Legacy delegating wrapper for bootstrap.
# The canonical implementation is the Node npm package at scripts/forge-launcher/.
# This wrapper keeps existing invocations working during the transition and is
# scheduled for removal (see ADR-023).

$PkgDir = Join-Path $PSScriptRoot "forge-launcher"
$Subcommand = @("bootstrap") + $args

function Invoke-Forge {
    $distCli = Join-Path $PkgDir "dist\cli.js"
    if (Test-Path $distCli -PathType Leaf) {
        & node $distCli $Subcommand
        exit $LASTEXITCODE
    }
    $tsxLocal = Join-Path $PkgDir "node_modules\.bin\tsx"
    $tsxGlobal = Get-Command tsx -ErrorAction SilentlyContinue
    if (Test-Path $tsxLocal) {
        & $tsxLocal (Join-Path $PkgDir "scripts\cli.ts") $Subcommand
        exit $LASTEXITCODE
    }
    if ($tsxGlobal) {
        & $tsxGlobal.Source (Join-Path $PkgDir "scripts\cli.ts") $Subcommand
        exit $LASTEXITCODE
    }
    Write-Error "bootstrap: package not built. Run in scripts\forge-launcher\: npm install; npm run build"
    exit 1
}

Invoke-Forge
