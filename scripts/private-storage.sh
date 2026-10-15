#!/bin/sh
# Resolve a private output directory without creating files in a checkout.
tradetally_private_path() {
    case "$1" in /*) ;; *) echo "Private storage requires an absolute external path" >&2; return 1 ;; esac
    _tt_path=$1
    _tt_suffix=''
    while [ ! -d "$_tt_path" ]; do
        [ "$_tt_path" != / ] || return 1
        _tt_suffix="/$(basename "$_tt_path")$_tt_suffix"
        _tt_path=$(dirname "$_tt_path")
    done
    _tt_path="$(cd "$_tt_path" && pwd -P)$_tt_suffix"
    # Canonicalize .. components before looking for checkout ancestry.
    case "$_tt_path" in */../*|*/..|*/./*|*/.) echo "Use a normalized private path" >&2; return 1 ;; esac
    _tt_parent=$_tt_path
    while [ "$_tt_parent" != / ]; do
        if [ -e "$_tt_parent/.git" ]; then
            echo "Private storage must be outside source checkouts" >&2
            return 1
        fi
        _tt_parent=$(dirname "$_tt_parent")
    done
    printf '%s\n' "$_tt_path"
}
