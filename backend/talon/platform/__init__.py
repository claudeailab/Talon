"""Platform back-ends: ``real`` drives the actual Linux host, ``demo`` is an
in-memory simulation used for UI development and previews."""


def get_platform(cfg):
    if cfg.demo:
        from .demo import DemoPlatform
        return DemoPlatform(cfg)
    from .real import RealPlatform
    return RealPlatform(cfg)
