cmake_minimum_required(VERSION 3.14)
project(hello-example)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

add_executable(main
	src/main.cpp
	src/hello.cpp
)

target_include_directories(main PUBLIC src/include)
