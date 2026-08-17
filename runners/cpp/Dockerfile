# Sandbox image for C++ submissions.
# Alpine + g++ keeps the image small; static linking at compile time means the
# run containers do not need the toolchain's shared libraries present.
FROM alpine:3.20

RUN apk add --no-cache g++ musl-dev libstdc++ libstdc++-dev

WORKDIR /sandbox

CMD ["/build/program"]
