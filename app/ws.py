from __future__ import annotations

import logging

from fastapi import WebSocket

from .config import save_desktop_stream_config

logger = logging.getLogger("uvicorn.error")


class Hub:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self.state: dict = {
            "selectedVideoId": None,
            "projection": "180_sbs_lr",
            "playing": False,
            "currentTime": 0,
            "volume": 1,
            "muted": False,
        }

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._clients.add(websocket)
        await websocket.send_json({"type": "state", "state": self.state})

    async def disconnect(self, websocket: WebSocket) -> None:
        self._clients.discard(websocket)

    async def handle(self, websocket: WebSocket, message: dict) -> None:
        msg_type = message.get("type")
        if isinstance(msg_type, str) and msg_type.startswith("browser-desktop"):
            logger.info("Desktop websocket message: %s", msg_type)

        if msg_type == "load":
            self.state.update(
                {
                    "selectedVideoId": message.get("videoId"),
                    "projection": message.get("projection", self.state["projection"]),
                    "currentTime": 0,
                    "playing": False,
                }
            )
        elif msg_type == "play":
            self.state["playing"] = True
        elif msg_type == "pause":
            self.state["playing"] = False
        elif msg_type == "seek":
            self.state["currentTime"] = float(message.get("currentTime", 0))
        elif msg_type == "volume":
            self.state["volume"] = float(message.get("volume", 1))
            self.state["muted"] = bool(message.get("muted", False))
        elif msg_type == "projection":
            self.state["projection"] = message.get("projection", self.state["projection"])
        elif msg_type == "headset-state":
            self.state.update(
                {
                    "currentTime": float(message.get("currentTime", self.state["currentTime"])),
                    "playing": bool(message.get("playing", self.state["playing"])),
                }
            )
        elif msg_type == "desktop-settings":
            settings = save_desktop_stream_config(message.get("settings") or {})
            await self.broadcast({"type": "desktop-settings", "settings": settings})
            return

        await self.broadcast(message)
        await self.broadcast({"type": "state", "state": self.state})

    async def broadcast(self, message: dict) -> None:
        dead: list[WebSocket] = []
        for client in self._clients:
            try:
                await client.send_json(message)
            except RuntimeError:
                dead.append(client)

        for client in dead:
            await self.disconnect(client)


hub = Hub()
