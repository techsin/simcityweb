// schedstat poller: poll <interval_us> <max_seconds> <out.bin> <stopfile> <schedstat path>...
// Writes records of int64: [realtime_ns, cpu_ns(path0), cpu_ns(path1), ...] every interval until the stop file
// exists, max_seconds elapse, or every path vanished. Buffered in memory, written at exit (and on SIGTERM).
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <time.h>
#include <fcntl.h>
#include <unistd.h>
#include <signal.h>
static int64_t *buf; static size_t n = 0, cap = 0; static int np; static const char *out;
static volatile sig_atomic_t stop = 0;
static void onsig(int s) { (void)s; stop = 1; }
static int64_t now_rt(void) { struct timespec t; clock_gettime(CLOCK_REALTIME, &t); return (int64_t)t.tv_sec * 1000000000LL + t.tv_nsec; }
static int64_t rd(int fd) { char b[128]; ssize_t k = pread(fd, b, sizeof b - 1, 0); if (k <= 0) return -1; b[k] = 0; return strtoll(b, NULL, 10); }
int main(int argc, char **argv) {
  if (argc < 6) { fprintf(stderr, "usage\n"); return 2; }
  long us = atol(argv[1]); double maxs = atof(argv[2]); out = argv[3]; const char *stopf = argv[4];
  np = argc - 5; int *fds = calloc(np, sizeof(int));
  for (int i = 0; i < np; i++) fds[i] = open(argv[5 + i], O_RDONLY);
  signal(SIGTERM, onsig); signal(SIGINT, onsig);
  cap = 1 << 20; buf = malloc(cap * sizeof(int64_t));
  int64_t t0 = now_rt(); struct timespec sl = { 0, us * 1000 };
  int k = 0;
  while (!stop) {
    if (n + np + 1 > cap) { cap *= 2; buf = realloc(buf, cap * sizeof(int64_t)); }
    int64_t t = now_rt(); buf[n++] = t; int alive = 0;
    for (int i = 0; i < np; i++) { int64_t v = fds[i] >= 0 ? rd(fds[i]) : -1; if (v >= 0) alive++; buf[n++] = v; }
    if (!alive) break;
    if ((t - t0) / 1e9 > maxs) break;
    if ((++k & 63) == 0 && access(stopf, F_OK) == 0) break;
    nanosleep(&sl, NULL);
  }
  FILE *f = fopen(out, "wb"); int32_t h = np; fwrite(&h, 4, 1, f); fwrite(buf, sizeof(int64_t), n, f); fclose(f);
  return 0;
}
