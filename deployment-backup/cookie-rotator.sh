#!/bin/bash
# Cookie Rotator - Rotates between multiple cookie profiles for better success rate
# This script selects a random cookie profile from the pool for each request

set -e

POOL_LIST_FILE="/app/chrome-profiles/cookie-pool-list.txt"
BASE_PROFILE_DIR="/app/chrome-profiles"

get_random_profile() {
  if [ ! -f "$POOL_LIST_FILE" ]; then
    # Fallback: find most recent profile
    if [ -d "$BASE_PROFILE_DIR" ]; then
      find "$BASE_PROFILE_DIR" -type d -name "enhanced-profile-*" -o -name "profile-*" | sort -r | head -1
    fi
    return
  fi
  
  # Get profiles from pool list
  local profiles=()
  while IFS= read -r line; do
    if [ -d "$line" ] && [ -f "$line/Default/Cookies" ]; then
      profiles+=("$line")
    fi
  done < "$POOL_LIST_FILE"
  
  if [ ${#profiles[@]} -eq 0 ]; then
    # Fallback to any available profile
    find "$BASE_PROFILE_DIR" -type d -name "enhanced-profile-*" -o -name "profile-*" | sort -r | head -1
    return
  fi
  
  # Return random profile
  local random_index=$((RANDOM % ${#profiles[@]}))
  echo "${profiles[$random_index]}"
}

# Usage: get_random_profile
# Returns: path to a random cookie profile directory

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  # If script is run directly, output the profile path
  get_random_profile
fi

