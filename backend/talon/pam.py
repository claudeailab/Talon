"""Minimal PAM authentication via ctypes (no third-party dependency)."""
from __future__ import annotations

from ctypes import (CDLL, CFUNCTYPE, POINTER, Structure, byref, c_char, c_char_p, c_int,
                    c_size_t, c_void_p, cast, memmove, sizeof)
from ctypes.util import find_library

PAM_PROMPT_ECHO_OFF = 1
PAM_PROMPT_ECHO_ON = 2
PAM_SUCCESS = 0


class PamHandle(Structure):
    _fields_ = [("handle", c_void_p)]


class PamMessage(Structure):
    _fields_ = [("msg_style", c_int), ("msg", c_char_p)]


class PamResponse(Structure):
    _fields_ = [("resp", c_char_p), ("resp_retcode", c_int)]


CONV_FUNC = CFUNCTYPE(c_int, c_int, POINTER(POINTER(PamMessage)),
                      POINTER(POINTER(PamResponse)), c_void_p)


class PamConv(Structure):
    _fields_ = [("conv", CONV_FUNC), ("appdata_ptr", c_void_p)]


_libpam = None
_libc = None


def _load():
    global _libpam, _libc
    if _libpam is None:
        _libpam = CDLL(find_library("pam") or "libpam.so.0")
        _libc = CDLL(find_library("c") or "libc.so.6")
        _libc.calloc.restype = c_void_p
        _libc.calloc.argtypes = [c_size_t, c_size_t]
        _libpam.pam_start.restype = c_int
        _libpam.pam_start.argtypes = [c_char_p, c_char_p, POINTER(PamConv), POINTER(PamHandle)]
        _libpam.pam_authenticate.restype = c_int
        _libpam.pam_authenticate.argtypes = [PamHandle, c_int]
        _libpam.pam_acct_mgmt.restype = c_int
        _libpam.pam_acct_mgmt.argtypes = [PamHandle, c_int]
        _libpam.pam_end.restype = c_int
        _libpam.pam_end.argtypes = [PamHandle, c_int]
    return _libpam, _libc


def authenticate(username: str, password: str, service: str = "talon") -> bool:
    if not username or not password or "\0" in username or "\0" in password:
        return False
    libpam, libc = _load()
    pw = password.encode()
    user = username.encode()

    @CONV_FUNC
    def conv(n_messages, messages, p_response, _app):
        addr = libc.calloc(n_messages, sizeof(PamResponse))
        response = cast(addr, POINTER(PamResponse))
        p_response[0] = response
        for i in range(n_messages):
            style = messages[i].contents.msg_style
            if style in (PAM_PROMPT_ECHO_OFF, PAM_PROMPT_ECHO_ON):
                value = pw if style == PAM_PROMPT_ECHO_OFF else user
                dst = libc.calloc(len(value) + 1, sizeof(c_char))
                memmove(dst, value, len(value))
                response[i].resp = dst
                response[i].resp_retcode = 0
        return PAM_SUCCESS

    handle = PamHandle()
    pconv = PamConv(conv, 0)
    rc = libpam.pam_start(service.encode(), user, byref(pconv), byref(handle))
    if rc != PAM_SUCCESS:
        return False
    try:
        rc = libpam.pam_authenticate(handle, 0)
        if rc == PAM_SUCCESS:
            rc = libpam.pam_acct_mgmt(handle, 0)
        return rc == PAM_SUCCESS
    finally:
        libpam.pam_end(handle, rc)
