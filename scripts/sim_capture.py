"""Capturas reales de la simulación mediante el protocolo CDP de Edge.

Uso:
    python scripts/sim_capture.py initial
    python scripts/sim_capture.py live
    python scripts/sim_capture.py final
"""

from __future__ import annotations

import asyncio
import base64
import json
import sys
from pathlib import Path

import httpx
import websockets

CDP_HTTP = "http://127.0.0.1:9222"
APP_URL = "http://127.0.0.1:5183"
OUT = Path(__file__).resolve().parents[1] / "docs" / "preview"


class CDP:
    def __init__(self, url: str) -> None:
        self.url = url
        self.ws = None
        self.next_id = 0

    async def connect(self) -> None:
        self.ws = await websockets.connect(self.url, max_size=None)

    async def close(self) -> None:
        if self.ws:
            await self.ws.close()

    async def send(self, method: str, params: dict | None = None) -> dict:
        self.next_id += 1
        request_id = self.next_id
        await self.ws.send(json.dumps({"id": request_id, "method": method, "params": params or {}}))
        while True:
            raw = await asyncio.wait_for(self.ws.recv(), timeout=120)
            message = json.loads(raw)
            if message.get("id") == request_id:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message.get("result", {})

    async def eval(self, script: str):
        result = await self.send(
            "Runtime.evaluate",
            {
                "expression": script,
                "returnByValue": True,
                "awaitPromise": True,
                "userGesture": True,
            },
        )
        value = result.get("result", {})
        if value.get("subtype") == "error":
            raise RuntimeError(value.get("description", "Error de evaluación"))
        return value.get("value")

    async def wait_text(self, text: str, timeout: float = 30.0) -> bool:
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            found = await self.eval(
                f"document.body && document.body.innerText.includes({json.dumps(text)})"
            )
            if found:
                return True
            await asyncio.sleep(0.5)
        return False

    async def wait_js(self, script: str, timeout: float = 30.0) -> bool:
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            if await self.eval(script):
                return True
            await asyncio.sleep(0.5)
        return False

    async def click_text(self, text: str, selector: str = "button") -> bool:
        return bool(
            await self.eval(
                f"""(() => {{
                const target = Array.from(document.querySelectorAll({json.dumps(selector)}))
                  .find(el => (el.textContent || '').trim().includes({json.dumps(text)}));
                if (!target) return false;
                target.click();
                return true;
              }})()"""
            )
        )

    async def scroll_main(self, top: int) -> None:
        await self.eval(
            f"""(() => {{
              const main = document.querySelector('main');
              if (main) main.scrollTop = {int(top)};
              window.scrollTo(0, {int(top)});
              return true;
            }})()"""
        )
        await asyncio.sleep(0.4)

    async def shot(self, name: str) -> str:
        await asyncio.sleep(0.6)
        result = await self.send(
            "Page.captureScreenshot",
            {"format": "jpeg", "quality": 84, "captureBeyondViewport": False},
        )
        path = OUT / f"{name}.jpeg"
        path.write_bytes(base64.b64decode(result["data"]))
        print(f"captura={path}")
        return str(path)


async def get_page(cdp: CDP) -> None:
    targets = httpx.get(f"{CDP_HTTP}/json/list", timeout=10).json()
    pages = [t for t in targets if t.get("type") == "page"]
    if not pages:
        raise RuntimeError("No hay pestaña disponible en Edge CDP")
    await cdp.connect()
    await cdp.send("Page.enable")
    await cdp.send("Runtime.enable")
    await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        {"width": 1440, "height": 1100, "deviceScaleFactor": 1, "mobile": False},
    )


async def login(cdp: CDP) -> None:
    await cdp.send("Page.navigate", {"url": APP_URL})
    await asyncio.sleep(2.5)
    if not await cdp.wait_js("!!document.getElementById('login-email')", timeout=20):
        return
    await cdp.eval(
        """(() => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          const email = document.getElementById('login-email');
          const password = document.getElementById('login-password');
          setter.call(email, 'admin@neurolab.enterprise');
          email.dispatchEvent(new Event('input', {bubbles:true}));
          setter.call(password, 'Admin123!');
          password.dispatchEvent(new Event('input', {bubbles:true}));
          const button = Array.from(document.querySelectorAll('button')).find(b => b.type === 'submit');
          button.click();
          return true;
        })()"""
    )
    if not await cdp.wait_text("TRABAJOS RECIENTES", timeout=40):
        raise RuntimeError("No se completó el inicio de sesión")


async def phase_initial(cdp: CDP) -> None:
    await login(cdp)
    await cdp.scroll_main(0)
    await cdp.shot("sim-01-panel")

    await cdp.click_text("Conjuntos de datos")
    await cdp.wait_text("Clientes del instituto", timeout=15)
    await cdp.shot("sim-02-dataset")

    await cdp.click_text("Diseñador de redes")
    await cdp.wait_text("MLP de referencia", timeout=15)
    await cdp.shot("sim-03-arquitectura")

    await cdp.click_text("Entrenamientos")
    await cdp.wait_text("HISTORIAL DE TRABAJOS", timeout=15)
    await cdp.eval(
        """(() => {
          const row = Array.from(document.querySelectorAll('tr'))
            .find(el => (el.textContent || '').includes('3f06d656'));
          if (row) row.click();
          return !!row;
        })()"""
    )
    await asyncio.sleep(0.8)
    await cdp.shot("sim-04-entrenamiento-en-cola")


async def phase_live(cdp: CDP) -> None:
    # Asegura estar en Entrenamientos y con el trabajo en vivo seleccionado.
    await cdp.click_text("Entrenamientos")
    await cdp.wait_text("HISTORIAL DE TRABAJOS", timeout=20)
    await cdp.eval(
        """(() => {
          const row = Array.from(document.querySelectorAll('tr'))
            .find(el => (el.textContent || '').includes('3f06d656'));
          if (row) row.click();
          return !!row;
        })()"""
    )
    await asyncio.sleep(1)

    captured = False
    deadline = asyncio.get_event_loop().time() + 900
    while asyncio.get_event_loop().time() < deadline:
        text = await cdp.eval("document.body.innerText")
        progress = await cdp.eval(
            """(() => {
              const node = Array.from(document.querySelectorAll('*'))
                .find(el => /^\\d{1,3}(\\.\\d+)?%$/.test((el.textContent || '').trim()) && el.children.length === 0);
              return node ? node.textContent.trim() : '0%';
            })()"""
        )
        numeric = float(progress.replace('%', '') or 0)
        if not captured and numeric >= 5:
            print(f"progreso={progress}")
            await cdp.scroll_main(280)
            await cdp.shot("sim-05-entrenamiento-en-vivo")
            await cdp.scroll_main(0)
            captured = True
        if "COMPLETADO" in text or "Completado" in text:
            break
        await asyncio.sleep(2)

    await cdp.scroll_main(0)
    await asyncio.sleep(1.5)
    await cdp.shot("sim-06-entrenamiento-completado")


async def phase_final(cdp: CDP) -> None:
    await cdp.click_text("Evaluación y métricas")
    await cdp.wait_text("Versiones registradas", timeout=25)
    await cdp.shot("sim-07-evaluacion")

    await cdp.click_text("Registro de modelos")
    await asyncio.sleep(2)
    await cdp.shot("sim-08-registro-borrador")

    await cdp.click_text("Ficha técnica")
    await asyncio.sleep(2)
    await cdp.scroll_main(0)
    await cdp.shot("sim-09-ficha-tecnica")


async def phase_approved(cdp: CDP) -> None:
    await cdp.click_text("Registro de modelos")
    await asyncio.sleep(2.5)
    await cdp.scroll_main(0)
    await cdp.shot("sim-08-registro-aprobado")

    await cdp.click_text("Evaluación y métricas")
    await cdp.wait_text("Versiones registradas", timeout=25)
    await cdp.scroll_main(0)
    await cdp.shot("sim-10-evaluacion-aprobada")


async def phase_verify(cdp: CDP) -> None:
    await cdp.click_text("Registro de modelos")
    await asyncio.sleep(3)
    text = await cdp.eval("document.body.innerText")
    print(text)


async def phase_tour(cdp: CDP) -> None:
    """Recorrido en vivo por las pantallas principales del sistema."""
    await login(cdp)
    await cdp.scroll_main(0)
    await cdp.shot("tour-01-panel")
    print("PANEL:", (await cdp.eval("document.body.innerText"))[:280].replace("\n", " | "))

    steps = [
        ("Conjuntos de datos", "Clientes del instituto", "tour-02-dataset"),
        ("Diseñador de redes", "MLP", "tour-03-arquitectura"),
        ("Entrenamientos", "HISTORIAL DE TRABAJOS", "tour-04-entrenamiento"),
        ("Evaluación y métricas", "Versiones registradas", "tour-05-evaluacion"),
        ("Registro de modelos", "v1.1", "tour-06-registro"),
        ("Ficha técnica", "Ficha", "tour-07-ficha-tecnica"),
        ("Administración", "Usuarios", "tour-08-administracion"),
    ]
    for nav, expect, name in steps:
        await cdp.click_text(nav)
        await cdp.wait_text(expect, timeout=25)
        await asyncio.sleep(1.2)
        if name == "tour-04-entrenamiento":
            await cdp.eval(
                """(() => {
                  const row = Array.from(document.querySelectorAll('tr'))
                    .find(el => (el.textContent || '').includes('bb7cb44f'));
                  if (row) row.click();
                  return !!row;
                })()"""
            )
            await asyncio.sleep(1.5)
        await cdp.scroll_main(0)
        await cdp.shot(name)
        print(f"{nav}:", (await cdp.eval("document.body.innerText"))[:240].replace("\n", " | "))


async def phase_check_training(cdp: CDP) -> None:
    await cdp.click_text("Entrenamientos")
    await cdp.wait_text("HISTORIAL DE TRABAJOS", timeout=20)
    clicked = await cdp.eval(
        """(() => {
          const nodes = Array.from(document.querySelectorAll('tr,button,div'))
            .filter(el => (el.textContent || '').includes('bb7cb44f') && el.children.length < 12);
          const row = nodes[0];
          if (row) row.click();
          return nodes.length;
        })()"""
    )
    await asyncio.sleep(1.5)
    text = await cdp.eval("document.body.innerText")
    start = text.find("Trabajo seleccionado")
    print("filas=", clicked)
    print(text[start : start + 400])


async def main() -> None:
    phase = sys.argv[1] if len(sys.argv) > 1 else "initial"
    cdp = CDP("")
    targets = httpx.get(f"{CDP_HTTP}/json/list", timeout=10).json()
    pages = [t for t in targets if t.get("type") == "page"]
    if not pages:
        raise RuntimeError("No hay pestaña disponible en Edge CDP")
    cdp.url = pages[0]["webSocketDebuggerUrl"]
    await cdp.connect()
    await cdp.send("Page.enable")
    await cdp.send("Runtime.enable")
    await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        {"width": 1440, "height": 1100, "deviceScaleFactor": 1, "mobile": False},
    )
    try:
        if phase == "initial":
            await phase_initial(cdp)
        elif phase == "live":
            await phase_live(cdp)
        elif phase == "final":
            await phase_final(cdp)
        elif phase == "approved":
            await phase_approved(cdp)
        elif phase == "tour":
            await phase_tour(cdp)
        elif phase == "check-training":
            await phase_check_training(cdp)
        else:
            raise RuntimeError(f"Fase desconocida: {phase}")
    finally:
        await cdp.close()


if __name__ == "__main__":
    asyncio.run(main())
