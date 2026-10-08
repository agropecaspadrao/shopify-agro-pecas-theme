// Recorta o fundo de uma foto usando o segmentador de assunto do macOS (Vision).
// Saída: PNG RGBA com a peça em alpha (fundo transparente).
//
//   swift recorte_vision.swift entrada.jpg saida.png
//
// Usado pelo 08_fotos_estudio.py — o flood fill do 06 não separa corpo de
// alumínio (claro e liso) do fundo cinza de estúdio; o Vision separa.
import Foundation
import Vision
import CoreImage

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("uso: recorte_vision.swift <entrada> <saida.png>\n".data(using: .utf8)!)
    exit(1)
}
let inURL = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])

guard let ci = CIImage(contentsOf: inURL) else {
    FileHandle.standardError.write("nao abriu \(inURL.path)\n".data(using: .utf8)!)
    exit(2)
}

let handler = VNImageRequestHandler(ciImage: ci, options: [:])
let req = VNGenerateForegroundInstanceMaskRequest()
do {
    try handler.perform([req])
    guard let res = req.results?.first, !res.allInstances.isEmpty else {
        FileHandle.standardError.write("nenhuma instancia detectada\n".data(using: .utf8)!)
        exit(3)
    }
    let buf = try res.generateMaskedImage(ofInstances: res.allInstances,
                                          from: handler,
                                          croppedToInstancesExtent: false)
    let ctx = CIContext()
    try ctx.writePNGRepresentation(of: CIImage(cvPixelBuffer: buf), to: outURL,
                                   format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
    print("ok \(outURL.lastPathComponent) (instancias: \(res.allInstances.count))")
} catch {
    FileHandle.standardError.write("erro: \(error)\n".data(using: .utf8)!)
    exit(4)
}
