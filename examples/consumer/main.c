#define _POSIX_C_SOURCE 200809L

#include "weapp_container_sdk.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
static void pause_ms(unsigned milliseconds) { Sleep(milliseconds); }
#else
#include <time.h>
static void pause_ms(unsigned milliseconds) {
  struct timespec delay = {
      .tv_sec = (time_t)(milliseconds / 1000),
      .tv_nsec = (long)(milliseconds % 1000) * 1000000L,
  };
  nanosleep(&delay, NULL);
}
#endif

static int contains_bytes(const uint8_t *data, size_t length, const char *needle) {
  const size_t needle_length = strlen(needle);
  if (needle_length == 0 || needle_length > length) return needle_length == 0;
  for (size_t index = 0; index + needle_length <= length; index += 1) {
    if (memcmp(data + index, needle, needle_length) == 0) return 1;
  }
  return 0;
}

static void print_result(const char *label, int32_t status,
                         const weapp_container_sdk_buffer *result) {
  fprintf(stderr, "%s returned %d: ", label, status);
  if (result->data != NULL) fwrite(result->data, 1, result->len, stderr);
  fputc('\n', stderr);
}

static int require_ok(const char *label, int32_t status,
                      weapp_container_sdk_buffer *result) {
  const int valid = status == WEAPP_CONTAINER_SDK_OK && result->data != NULL &&
                    contains_bytes(result->data, result->len, "\"ok\":true");
  if (!valid) print_result(label, status, result);
  weapp_container_sdk_buffer_free(result);
  return valid ? 0 : 1;
}

static int command(weapp_container_sdk_session *session, const char *operation,
                   const char *payload) {
  weapp_container_sdk_buffer result = {NULL, 0};
  const int32_t status = weapp_container_sdk_session_command(
      session, (const uint8_t *)operation, strlen(operation),
      (const uint8_t *)payload, strlen(payload), &result);
  return require_ok(operation, status, &result);
}

static int read_json_string_field(const uint8_t *json, size_t length,
                                  const char *field, char *output,
                                  size_t output_size) {
  char key[64];
  const int key_length = snprintf(key, sizeof(key), "\"%s\"", field);
  if (key_length < 0 || (size_t)key_length >= sizeof(key)) return 0;

  for (size_t index = 0; index + (size_t)key_length <= length; index += 1) {
    if (memcmp(json + index, key, (size_t)key_length) != 0) continue;
    index += (size_t)key_length;
    while (index < length && (json[index] == ' ' || json[index] == '\n' ||
                              json[index] == '\r' || json[index] == '\t')) {
      index += 1;
    }
    if (index >= length || json[index++] != ':') return 0;
    while (index < length && (json[index] == ' ' || json[index] == '\n' ||
                              json[index] == '\r' || json[index] == '\t')) {
      index += 1;
    }
    if (index >= length || json[index++] != '"') return 0;

    size_t written = 0;
    while (index < length) {
      uint8_t value = json[index++];
      if (value == '"') {
        if (written >= output_size) return 0;
        output[written] = '\0';
        return 1;
      }
      if (value == '\\') {
        if (index >= length) return 0;
        value = json[index++];
        if (value != '"' && value != '\\' && value != '/') return 0;
      }
      if (value < 0x20 || written + 1 >= output_size) return 0;
      output[written++] = (char)value;
    }
    return 0;
  }
  return 0;
}

static char *host_call_result_payload(const char *call_id) {
  const size_t input_length = strlen(call_id);
  const char *suffix = "\",\"result\":{\"echo\":true}}";
  char *payload = (char *)malloc(input_length * 2 + 48);
  if (payload == NULL) return NULL;
  char *cursor = payload;
  memcpy(cursor, "{\"callId\":\"", 11);
  cursor += 11;
  for (size_t index = 0; index < input_length; index += 1) {
    if (call_id[index] == '\\' || call_id[index] == '"') *cursor++ = '\\';
    *cursor++ = call_id[index];
  }
  memcpy(cursor, suffix, strlen(suffix) + 1);
  return payload;
}

static char *load_payload(const char *pack_path) {
  const size_t input_length = strlen(pack_path);
  char *payload = (char *)malloc(input_length * 2 + 32);
  if (payload == NULL) return NULL;
  char *cursor = payload;
  memcpy(cursor, "{\"packPath\":\"", 13);
  cursor += 13;
  for (size_t index = 0; index < input_length; index += 1) {
    const unsigned char value = (unsigned char)pack_path[index];
    if (value == '\\' || value == '"') *cursor++ = '\\';
    if (value < 0x20) {
      free(payload);
      return NULL;
    }
    *cursor++ = (char)value;
  }
  memcpy(cursor, "\"}", 3);
  return payload;
}

static int take_events(weapp_container_sdk_session *session, int *saw_frame,
                       int *saw_closed) {
  weapp_container_sdk_buffer result = {NULL, 0};
  const int32_t status = weapp_container_sdk_session_command(
      session, (const uint8_t *)"takeEvents", 10, (const uint8_t *)"{}", 2,
      &result);
  if (status != WEAPP_CONTAINER_SDK_OK || result.data == NULL) {
    print_result("takeEvents", status, &result);
    weapp_container_sdk_buffer_free(&result);
    return 1;
  }
  if (contains_bytes(result.data, result.len, "\"type\":\"frame\"")) {
    *saw_frame = 1;
  }
  if (contains_bytes(result.data, result.len, "\"type\":\"closed\"")) {
    *saw_closed = 1;
  }
  char call_id[256];
  char method[128];
  const int has_host_call =
      contains_bytes(result.data, result.len, "\"type\":\"hostCall\"");
  const int has_call_id =
      has_host_call && read_json_string_field(result.data, result.len,
                                              "callId", call_id,
                                              sizeof(call_id));
  const int has_method =
      has_host_call && read_json_string_field(result.data, result.len,
                                              "method", method,
                                              sizeof(method));
  fwrite(result.data, 1, result.len, stdout);
  fputc('\n', stdout);
  weapp_container_sdk_buffer_free(&result);

  if (has_host_call) {
    if (!has_call_id || !has_method || strcmp(method, "native.echo") != 0) {
      fprintf(stderr, "Unhandled or malformed hostCall event\n");
      return 1;
    }
    char *payload = host_call_result_payload(call_id);
    if (payload == NULL) return 1;
    const int status = command(session, "completeHostCall", payload);
    free(payload);
    if (status != 0) return 1;
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "Usage: %s /absolute/path/to/portable-pack\n", argv[0]);
    return 2;
  }
  if (weapp_container_sdk_abi_version() != WEAPP_CONTAINER_SDK_ABI_VERSION) {
    fprintf(stderr, "Unsupported SDK ABI\n");
    return 3;
  }
  printf("Weapp Container SDK %s\n", weapp_container_sdk_version());

  weapp_container_sdk_session *session = NULL;
  weapp_container_sdk_buffer result = {NULL, 0};
  const int32_t new_status = weapp_container_sdk_session_new(
      (const uint8_t *)"{}", 2, &session, &result);
  if (new_status != WEAPP_CONTAINER_SDK_OK) {
    print_result("session_new", new_status, &result);
    weapp_container_sdk_buffer_free(&result);
    return 4;
  }
  weapp_container_sdk_buffer_free(&result);

  int exit_code = 0;
  exit_code = command(session, "registerHostMethod",
                      "{\"name\":\"native.echo\"}");
  if (exit_code != 0) goto close_session;
  char *payload = load_payload(argv[1]);
  if (payload == NULL) {
    fprintf(stderr, "Could not encode pack path\n");
    exit_code = 5;
    goto close_session;
  }
  {
    const char *metrics =
        "{\"windowWidth\":375,\"windowHeight\":667,\"screenWidth\":375,"
        "\"screenHeight\":667,\"pixelRatio\":1,\"statusBarHeight\":0,"
        "\"screenTop\":0,\"deviceOrientation\":\"portrait\"}";
    const int32_t status = weapp_container_sdk_session_command(
        session, (const uint8_t *)"windowMetrics", 13,
        (const uint8_t *)metrics, strlen(metrics), &result);
    exit_code |= require_ok("windowMetrics", status, &result);
  }
  {
    const int32_t status = weapp_container_sdk_session_command(
        session, (const uint8_t *)"load", 4, (const uint8_t *)payload,
        strlen(payload), &result);
    exit_code |= require_ok("load", status, &result);
  }
  free(payload);
  if (exit_code != 0) goto close_session;

  int saw_frame = 0;
  for (unsigned attempt = 0; attempt < 100 && !saw_frame; attempt += 1) {
    exit_code |= command(session, "pump", "{}");
    int saw_closed = 0;
    exit_code |= take_events(session, &saw_frame, &saw_closed);
    if (!saw_frame) pause_ms(10);
  }
  if (!saw_frame) {
    fprintf(stderr, "The portable pack did not produce a frame\n");
    exit_code = 6;
    goto close_session;
  }

  {
    const weapp_container_sdk_frame *frame = NULL;
    const int32_t status = weapp_container_sdk_frame_acquire(
        session, &frame, &result);
    exit_code |= require_ok("frame_acquire", status, &result);
    if (frame != NULL) {
      weapp_container_sdk_frame_info_data info = {0};
      const int32_t info_status =
          weapp_container_sdk_frame_info(frame, &info, &result);
      exit_code |= require_ok("frame_info", info_status, &result);
      if (info.width == 0 || info.height == 0 || info.stride < info.width * 4 ||
          info.data == NULL) {
        fprintf(stderr, "Invalid frame dimensions or pixel buffer\n");
        exit_code = 7;
      } else {
        printf("First frame: %ux%u stride=%u revision=%llu\n", info.width,
               info.height, info.stride, (unsigned long long)info.revision);
      }
      exit_code |= require_ok(
          "frame_release",
          weapp_container_sdk_frame_release(&frame, &result), &result);
    }
  }
  exit_code |= command(session, "sendMessage",
                       "{\"message\":{\"kind\":\"contract-consumer\"}}");

close_session:
  exit_code |= command(session, "close", "{}");
  {
    int saw_frame = 0;
    int saw_closed = 0;
    for (unsigned attempt = 0; attempt < 100 && !saw_closed; attempt += 1) {
      exit_code |= command(session, "pump", "{}");
      exit_code |= take_events(session, &saw_frame, &saw_closed);
      if (!saw_closed) pause_ms(10);
    }
    if (!saw_closed) {
      fprintf(stderr, "The session did not emit a closed event\n");
      exit_code = 8;
    }
  }
  exit_code |= require_ok(
      "session_destroy",
      weapp_container_sdk_session_destroy(&session, &result), &result);
  return exit_code == 0 ? 0 : 1;
}
