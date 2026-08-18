"""Contrato de un módulo.

Un módulo agrupa TRES cosas que siempre van juntas y que antes estaban regadas:
sus tools, sus handlers, y el bloque de prompt que las explica. Así un cliente
de citas nunca ve una palabra sobre domicilios, y el modelo no tiene ni la
tentación de llamar una herramienta que no existe para ese negocio.
"""
from dataclasses import dataclass, field


@dataclass
class Contexto:
    """Lo que un handler necesita saber del turno en curso."""
    conv_id: int
    telefono: str
    perfil: object
    # En simulación NADA sale al cliente: los handlers describen lo que harían.
    # Es lo que permite configurar y probar un bot antes de entregarlo.
    simulacion: bool = False
    # Efectos que el simulador muestra en pantalla en vez de ejecutar.
    efectos: list = field(default_factory=list)

    def registrar(self, descripcion: str) -> None:
        self.efectos.append(descripcion)


@dataclass
class Resultado:
    """Lo que un handler le devuelve al modelo (y al motor)."""
    texto: str
    escalar: bool = False
    motivo: str = ""
    etiquetas: list[str] = field(default_factory=list)
    # Lo que hay que mostrar al lado del chat. El motor los escribe; el handler
    # no llama a la API, así que en simulación no se toca nada.
    atributos: dict = field(default_factory=dict)
    atributos_contacto: dict = field(default_factory=dict)


class Modulo:
    nombre = ""

    def tools(self, p) -> list[dict]:
        """Definiciones de tools para la API, ya interpoladas con el perfil."""
        return []

    def bloques_prompt(self, p) -> list[str]:
        """Lo que este módulo le explica al modelo (catálogo, tarifas, agenda…)."""
        return []

    def etiquetas(self) -> set[str]:
        """Etiquetas que este módulo puede llegar a poner."""
        return set()

    def atributos(self, p) -> list[dict]:
        """Atributos que este módulo escribe, para que el panel los cree en
        Chatsuite. Si no existen como definición, Chatwoot guarda el valor pero
        NO lo muestra en la barra lateral ni deja filtrar por él.

        Cada uno: {clave, titulo, tipo, modelo}
          tipo   → text | number | date | list | checkbox
          modelo → conversacion (del caso) | contacto (de la persona)
        """
        return []

    async def ejecutar(self, tool: str, entrada: dict, ctx: Contexto) -> Resultado | None:
        """None si la tool no es de este módulo."""
        return None
