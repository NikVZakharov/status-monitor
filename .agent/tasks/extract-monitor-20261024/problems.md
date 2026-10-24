# Installer activation failure — resolved in v0.1.1

The first runtime cutover exposed an installer defect: a secure operator umask made newly created source directories mode 0700, so the dedicated service user could not traverse them. Release-file hashes were valid, but activation failed. The installer restored the previous runtime/environment/unit; independent HTTPS readback returned 200 afterward. No other consumer was changed by this failed attempt.

Fix: normalize staged directory permissions to 0755, regular files to 0644 and shell launchers to 0755 before stopping the existing service. A regression creates the staging tree under umask 077 and verifies service-readable permissions. Runtime cutover will retry using the fixed immutable patch release; v0.1.0 remains historical evidence and must not be used for fresh installation.

The v0.1.1 regression and Linux Quality passed. All four runtime applies and independent readbacks subsequently passed. MyRobotica source-publication authorization is a separate remaining delivery condition recorded in evidence.md.
