#!/usr/bin/env bash
set -euo pipefail

readonly PROJECT='ford-mcp'
readonly RETIRE_SERVICES=(mcp-blue mcp-green mcp mcp-proxy)

docker_project_inventory() {
  local container_ids container_id
  container_ids="$(docker ps -aq --filter "label=com.docker.compose.project=${PROJECT}")"
  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    docker inspect --format '{{.Id}}|{{.Name}}|{{.State.Status}}|{{.Config.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}' "$container_id"
  done <<<"$container_ids"
}

validate_project_inventory() {
  local inventory="$1"
  local container_id container_name container_state image container_project service
  local scheduler_count=0 ollama_count=0 ollama_model_count=0
  scheduler_id=''
  ollama_id=''

  [[ -n "$inventory" ]] || {
    echo 'No ford-mcp Compose project containers found; refusing retirement.' >&2
    return 1
  }

  while IFS='|' read -r container_id container_name container_state image container_project service; do
    [[ -n "$container_id" ]] || continue
    [[ "$container_project" == "$PROJECT" ]] || {
      printf 'Unexpected Compose project in inventory: %s (%s)\n' "$container_project" "$container_name" >&2
      return 1
    }
    case "$service" in
      mcp-blue|mcp-green|mcp|mcp-proxy|cloudflared|scheduler|ollama|ollama-model) ;;
      *)
        printf 'Unexpected ford-mcp project service: %s (%s)\n' "$service" "$container_name" >&2
        return 1
        ;;
    esac
    container_name="${container_name#/}"
    printf 'Container: project=%s service=%s name=%s state=%s image=%s\n' \
      "$container_project" "$service" "$container_name" "$container_state" "$image"

    if [[ "$service" == scheduler ]]; then
      scheduler_count=$((scheduler_count + 1))
      scheduler_id="$container_id"
      [[ "$container_name" == ford-scraping-scheduler && "$container_state" == running ]] || {
        echo 'Expected the current ford-scraping-scheduler to be running; refusing retirement.' >&2
        return 1
      }
    elif [[ "$service" == ollama ]]; then
      ollama_count=$((ollama_count + 1))
      ollama_id="$container_id"
      [[ "$container_state" == running ]] || {
        echo 'Expected the shared Ollama service to be running; refusing retirement.' >&2
        return 1
      }
    elif [[ "$service" == ollama-model ]]; then
      ollama_model_count=$((ollama_model_count + 1))
    fi
  done <<<"$inventory"

  [[ "$scheduler_count" == 1 && -n "$scheduler_id" ]] || {
    echo 'Expected exactly one scheduler in the shared Compose project; refusing retirement.' >&2
    return 1
  }
  [[ "$ollama_count" == 1 && -n "$ollama_id" ]] || {
    echo 'Expected exactly one running Ollama dependency; refusing retirement.' >&2
    return 1
  }
  [[ "$ollama_model_count" -le 1 ]] || {
    echo 'Unexpected duplicate Ollama model initializer; refusing retirement.' >&2
    return 1
  }
}

verify_shared_dependencies() {
  docker network inspect data_default >/dev/null
  docker volume inspect ford-mcp_ollama-data >/dev/null
  docker exec -u postgres data-postgres-1 pg_isready -U ford -d ford_service >/dev/null
}

verify_mcp_listeners_closed() {
  local port
  for port in 3001 3101 3102; do
    if timeout 3 bash -c "</dev/tcp/127.0.0.1/${port}" 2>/dev/null; then
      printf 'MCP listener is still open on 127.0.0.1:%s\n' "$port" >&2
      return 1
    fi
  done
}

before="$(docker_project_inventory)"
validate_project_inventory "$before"
verify_shared_dependencies
original_scheduler_id="$scheduler_id"
original_ollama_id="$ollama_id"

declare -a target_ids=()
declare -a target_names=()
declare -a target_states=()
while IFS='|' read -r container_id container_name container_state image container_project service; do
  [[ -n "$container_id" ]] || continue
  for target_service in "${RETIRE_SERVICES[@]}"; do
    if [[ "$service" == "$target_service" ]]; then
      target_ids+=("$container_id")
      target_names+=("$container_name")
      target_states+=("$container_state")
      break
    fi
  done
done <<<"$before"

if ((${#target_ids[@]} > 0)); then
  printf 'MCP-only containers selected for removal: %s\n' "${target_names[*]}"
  for index in "${!target_ids[@]}"; do
    if [[ "${target_states[$index]}" == running ]]; then
      docker stop --time 30 "${target_ids[$index]}" >/dev/null
    fi
    docker rm "${target_ids[$index]}" >/dev/null
    printf 'Removed MCP-only container: %s\n' "${target_names[$index]}"
  done
else
  echo 'No MCP-only containers remain; runtime already retired.'
fi

after="$(docker_project_inventory)"
validate_project_inventory "$after"
[[ "$scheduler_id" == "$original_scheduler_id" ]] || {
  echo 'Scraper scheduler identity changed during MCP retirement.' >&2
  exit 1
}
[[ "$ollama_id" == "$original_ollama_id" ]] || {
  echo 'Shared Ollama identity changed during MCP retirement.' >&2
  exit 1
}

for target_service in "${RETIRE_SERVICES[@]}"; do
  service_found=false
  while IFS='|' read -r _ _ _ _ _ service; do
    if [[ "$service" == "$target_service" ]]; then
      service_found=true
      break
    fi
  done <<<"$after"
  if [[ "$service_found" == true ]]; then
    printf 'MCP-only service remains after retirement: %s\n' "$target_service" >&2
    exit 1
  fi
done

verify_shared_dependencies
verify_mcp_listeners_closed
echo 'Scraper scheduler, Ollama/model dependency, Ollama volume, data network, PostgreSQL, and Redis remain.'
echo 'Cloudflared, MCP environment/config files, images, Vault secrets, and Cloudflare metadata are preserved for separate route cleanup/rollback.'
