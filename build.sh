#!/bin/sh

export LUA_PATH="$PWD/filters/?.lua;;"
mkdir -p _shake
ghc --make Setup.hs -rtsopts -threaded -with-rtsopts=-I0 -outputdir=_shake -o _shake/build && _shake/build "$@"
