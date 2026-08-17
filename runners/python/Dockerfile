# Sandbox image for Python submissions.
# Deliberately minimal: no package manager at runtime, no shell utilities the
# submitted program could shell out to beyond what python itself provides.
FROM python:3.11-alpine

# `nobody` (65534) already exists in Alpine; the container runs as that uid.
# No application user is created and nothing is installed on top of the base.

WORKDIR /sandbox

# Overridden by the judge on every run; present so the image is runnable alone.
CMD ["python3", "-I", "/sandbox/main.py"]
