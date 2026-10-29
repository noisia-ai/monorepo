# << Asunto >>

> Plantilla del mail que acompaña una entrega de datos. Ver `DATA_DELIVERY.md` §9. El tono explica
> cómo funciona y qué se puede sumar; no diagnostica ni pide espera. Ningún compromiso que no esté
> verificado. **Nunca el nombre del proveedor de la escucha**: si hace falta, "the data source" o "la
> fuente". Corre `builders/check-delivery.py --forbid` sobre este texto antes de mandarlo. Borra este
> bloque al usarla.

<< Saludo, una línea. >>

**Lo que va.**
- `<< archivo >>`: << qué es >>, << n >> filas.

**Cómo se filtró.**
- << Filtro >>: quitó << n >> filas.

**Lo que no se replica, y por qué.**
- << Columna >>: << la calcula su herramienta actual con su modelo / no existe en la fuente / es un
  campo que se llena en su workspace >>.

**Cómo funciona.**
- << Lo que el cliente va a ver: una red que recolecta hacia adelante, métricas al momento de
  recolección, el contexto del hilo en su propia columna. Dicho como diseño, no como disculpa. >>

**Lo que se puede sumar.**
- << Solo lo que ya está verificado. >>

<< Siguiente paso concreto y firma. >>
