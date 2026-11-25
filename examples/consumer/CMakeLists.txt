cmake_minimum_required(VERSION 3.21)
project(WeappContainerContractConsumer LANGUAGES C)

set(WEAPP_CONTAINER_SDK_INCLUDE_DIR "" CACHE PATH "Directory containing weapp_container_sdk.h")
set(WEAPP_CONTAINER_SDK_LIBRARY "" CACHE FILEPATH "Path to libweapp_container_sdk")

if(NOT WEAPP_CONTAINER_SDK_INCLUDE_DIR OR NOT WEAPP_CONTAINER_SDK_LIBRARY)
  message(FATAL_ERROR "Set WEAPP_CONTAINER_SDK_INCLUDE_DIR and WEAPP_CONTAINER_SDK_LIBRARY")
endif()

add_executable(contract_consumer main.c)
target_include_directories(contract_consumer PRIVATE "${WEAPP_CONTAINER_SDK_INCLUDE_DIR}")
target_link_libraries(contract_consumer PRIVATE "${WEAPP_CONTAINER_SDK_LIBRARY}")
if(APPLE)
  foreach(framework AppKit Metal MetalKit QuartzCore CoreGraphics CoreText
                    CoreFoundation Foundation IOSurface Security
                    SystemConfiguration IOKit)
    target_link_libraries(contract_consumer PRIVATE "-framework ${framework}")
  endforeach()
  target_link_libraries(contract_consumer PRIVATE c++ iconv resolv)
elseif(WIN32)
  target_link_libraries(contract_consumer PRIVATE ws2_32 bcrypt crypt32 userenv advapi32)
else()
  target_link_libraries(contract_consumer PRIVATE dl pthread m)
  target_link_libraries(contract_consumer PRIVATE stdc++)
endif()
